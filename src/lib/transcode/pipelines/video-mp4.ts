/**
 * Video MP4 Transcode Pipeline
 *
 * Transforms source video into an H.264/AAC MP4 with progressive playback.
 * Flow: fetchSourceInfo -> downloadSource -> transcode -> validateOutput
 *   -> uploadVariant -> (best effort) extractFirstFrame -> uploadThumbnail
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { assetMedia } from '@/db/schema';
import { getR2ObjectStream, uploadToR2 } from '@/lib/storage/r2-client';

import { VIDEO_MP4_PARAMS } from '../constants';

import type { ProcessResult } from '../worker/processor';

// ============================================================================
// Types
// ============================================================================

interface Job {
  id: string;
  mediaId: string;
  jobType: string;
}

interface SourceInfo {
  r2Key: string;
}

interface FfprobeVideoStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeResult {
  streams: FfprobeVideoStream[];
  format: FfprobeFormat;
}

// ============================================================================
// Pipeline Steps
// ============================================================================

/** Fetch the source media's R2 key from the asset_media table */
async function fetchSourceInfo(mediaId: string): Promise<SourceInfo> {
  console.log('[PIPELINE] Fetching source info for media:', mediaId);

  const [media] = await db
    .select({ r2Key: assetMedia.r2Key })
    .from(assetMedia)
    .where(eq(assetMedia.id, mediaId))
    .limit(1);

  if (!media) {
    throw new Error(`Source media not found: ${mediaId}`);
  }

  return { r2Key: media.r2Key };
}

/** Stream-download the source file from R2 to a local temp path */
async function downloadSource(r2Key: string, destPath: string): Promise<void> {
  console.log('[PIPELINE] Downloading source from R2:', r2Key);

  const readable = await getR2ObjectStream(r2Key);
  const writable = createWriteStream(destPath);

  await pipeline(readable, writable);

  const { size } = await stat(destPath);
  console.log('[PIPELINE] Download complete:', size, 'bytes');
}

/** Spawn an ffmpeg child process and resolve/reject on exit */
function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  const { codec, crf, preset, audioCodec, audioBitrate } = VIDEO_MP4_PARAMS;

  const args = [
    '-y',
    '-i', inputPath,
    '-c:v', codec,
    '-crf', String(crf),
    '-preset', preset,
    '-c:a', audioCodec,
    '-b:a', audioBitrate,
    '-movflags', '+faststart',
    outputPath,
  ];

  console.log('[PIPELINE] Starting ffmpeg transcode');

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) =>
      reject(new Error(`ffmpeg spawn error: ${err.message}`)),
    );

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[PIPELINE] ffmpeg transcode completed successfully');
        return resolve();
      }

      const stderr = Buffer.concat(stderrChunks).toString().slice(-2000);
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

/** Extract the first frame from transcoded output as a JPEG thumbnail */
function extractFirstFrame(videoPath: string, thumbnailPath: string): Promise<void> {
  const args = [
    '-y',
    '-i', videoPath,
    '-vf', 'select=eq(n\\,0)',
    '-vframes', '1',
    '-q:v', '2',
    thumbnailPath,
  ];

  console.log('[PIPELINE] Extracting first frame thumbnail');

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) =>
      reject(new Error(`ffmpeg thumbnail spawn error: ${err.message}`)),
    );

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[PIPELINE] First frame thumbnail extracted');
        return resolve();
      }

      const stderr = Buffer.concat(stderrChunks).toString().slice(-2000);
      reject(new Error(`ffmpeg thumbnail exited with code ${code}: ${stderr}`));
    });
  });
}

/** Run ffprobe on the output file and validate H.264 codec, extract metadata */
function validateOutput(
  filePath: string,
): Promise<{ width: number; height: number; duration: number }> {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ];

  console.log('[PIPELINE] Validating output with ffprobe');

  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

    const stderrChunks: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) =>
      reject(new Error(`ffprobe spawn error: ${err.message}`)),
    );

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString().slice(-2000);
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }

      try {
        const raw = Buffer.concat(stdoutChunks).toString();
        const probe: FfprobeResult = JSON.parse(raw);

        const videoStream = probe.streams.find(
          (s) => s.codec_type === 'video',
        );

        if (!videoStream) {
          return reject(new Error('ffprobe: no video stream found in output'));
        }

        if (videoStream.codec_name !== 'h264') {
          return reject(
            new Error(
              `ffprobe: expected h264 codec, got ${videoStream.codec_name}`,
            ),
          );
        }

        const width = videoStream.width ?? 0;
        const height = videoStream.height ?? 0;
        const duration = probe.format.duration
          ? parseFloat(probe.format.duration)
          : 0;

        console.log(
          `[PIPELINE] Validation passed: ${width}x${height}, ${duration.toFixed(2)}s, h264`,
        );

        resolve({ width, height, duration });
      } catch (parseErr) {
        reject(
          new Error(
            `ffprobe: failed to parse output - ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          ),
        );
      }
    });
  });
}

/** Read the transcoded file and upload it to R2 */
async function uploadVariant(
  filePath: string,
  mediaId: string,
): Promise<{ r2Key: string; r2Url: string; fileSize: number }> {
  const variantR2Key = `variants/${mediaId}/video_mp4.mp4`;

  console.log('[PIPELINE] Uploading variant to R2:', variantR2Key);

  const buffer = await readFile(filePath);

  const result = await uploadToR2({
    key: variantR2Key,
    buffer,
    contentType: 'video/mp4',
  });

  console.log('[PIPELINE] Upload complete:', result.size, 'bytes');

  return {
    r2Key: result.key,
    r2Url: result.url,
    fileSize: result.size,
  };
}

/** Read the extracted thumbnail and upload it to R2 */
async function uploadThumbnail(
  filePath: string,
  mediaId: string,
): Promise<{ r2Key: string; r2Url: string; fileSize: number }> {
  const thumbnailR2Key = `variants/${mediaId}/thumbnail-first-frame.jpg`;

  console.log('[PIPELINE] Uploading thumbnail to R2:', thumbnailR2Key);

  const buffer = await readFile(filePath);
  const result = await uploadToR2({
    key: thumbnailR2Key,
    buffer,
    contentType: 'image/jpeg',
  });

  console.log('[PIPELINE] Thumbnail upload complete:', result.size, 'bytes');

  return {
    r2Key: result.key,
    r2Url: result.url,
    fileSize: result.size,
  };
}

// ============================================================================
// Public Entry Point
// ============================================================================

/**
 * Execute the full video MP4 transcode pipeline.
 *
 * 1. Fetch source media R2 key from DB
 * 2. Stream-download source from R2 to temp directory
 * 3. Transcode with ffmpeg (H.264 + AAC, progressive playback)
 * 4. Validate output with ffprobe (codec, dimensions, duration)
 * 5. Upload transcoded variant to R2 (required)
 * 6. Extract first frame thumbnail (best effort)
 * 7. Upload thumbnail to R2 (best effort)
 */
export async function processVideoMp4(
  job: Job,
  tempDir: string,
): Promise<ProcessResult> {
  const inputPath = join(tempDir, 'source');
  const outputPath = join(tempDir, 'video_mp4.mp4');
  const thumbnailPath = join(tempDir, 'thumbnail-first-frame.jpg');

  console.log(`[PIPELINE] Starting video_mp4 pipeline for job=${job.id} media=${job.mediaId}`);

  // Step 1: Fetch source info
  const { r2Key } = await fetchSourceInfo(job.mediaId);

  // Step 2: Download source from R2
  await downloadSource(r2Key, inputPath);

  // Step 3: Transcode with ffmpeg
  await runFfmpeg(inputPath, outputPath);

  // Step 4: Validate output with ffprobe
  const { width, height, duration } = await validateOutput(outputPath);

  // Step 5: Upload variant to R2 (required)
  const upload = await uploadVariant(outputPath, job.mediaId);

  // Step 6-7: Generate/upload thumbnail as best effort.
  // If thumbnail fails, keep transcode success so video playback is not blocked.
  let thumbnailUpload: { r2Key: string; r2Url: string; fileSize: number } | null = null;
  try {
    await extractFirstFrame(outputPath, thumbnailPath);
    thumbnailUpload = await uploadThumbnail(thumbnailPath, job.mediaId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[PIPELINE] Thumbnail generation/upload failed for media=${job.mediaId}. Continuing without thumbnail: ${message}`,
    );
  }

  console.log(`[PIPELINE] Pipeline complete for job=${job.id}`);

  return {
    variantR2Key: upload.r2Key,
    variantR2Url: upload.r2Url,
    thumbnailR2Key: thumbnailUpload?.r2Key,
    thumbnailR2Url: thumbnailUpload?.r2Url,
    fileSize: upload.fileSize,
    format: 'mp4',
    width,
    height,
    duration,
  };
}
