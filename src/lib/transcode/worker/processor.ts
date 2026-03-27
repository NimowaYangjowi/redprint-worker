/**
 * Job Processor
 * Dispatches transcode jobs to the correct pipeline based on job type.
 * Supports dry-run mode for testing queue flow without ffmpeg/R2.
 */

import { isDryRun } from '../constants';
import { processVideoMp4 } from '../pipelines/video-mp4';

import type { CompleteParams } from '../queue-queries';

export interface ProcessResult {
  variantR2Key: string;
  variantR2Url: string;
  fileSize: number;
  format: string;
  thumbnailR2Key?: string;
  thumbnailR2Url?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Process a single transcode job.
 * Returns variant metadata on success.
 */
export async function processJob(
  job: { id: string; mediaId: string; jobType: string },
  tempDir: string
): Promise<ProcessResult> {
  switch (job.jobType) {
  case 'video_mp4':
    return isDryRun()
      ? processDryRun(job)
      : processVideoMp4(job, tempDir);
  case 'video_hevc':
    throw new Error('Unsupported job type: video_hevc (pipeline not implemented yet)');
  default:
    throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

/** Dry-run: skip ffmpeg/R2, return mock variant data */
function processDryRun(
  job: { id: string; mediaId: string; jobType: string }
): ProcessResult {
  console.log(`[DRY-RUN] Would transcode ${job.mediaId} as ${job.jobType}`);
  return {
    variantR2Key: `variants/${job.mediaId}/dry-run.mp4`,
    variantR2Url: `https://dry-run.local/variants/${job.mediaId}/dry-run.mp4`,
    fileSize: 0,
    format: 'video/mp4',
    thumbnailR2Key: `variants/${job.mediaId}/thumbnail-first-frame.jpg`,
    thumbnailR2Url: `https://dry-run.local/variants/${job.mediaId}/thumbnail-first-frame.jpg`,
  };
}


/** Build CompleteParams from job + process result */
export function toCompleteParams(
  job: { id: string; mediaId: string; jobType: string; startedAt: Date },
  result: ProcessResult
): CompleteParams {
  return {
    jobId: job.id,
    mediaId: job.mediaId,
    jobType: job.jobType,
    expectedStartedAt: job.startedAt,
    variantR2Key: result.variantR2Key,
    variantR2Url: result.variantR2Url,
    thumbnailR2Url: result.thumbnailR2Url,
    fileSize: result.fileSize,
    format: result.format,
    width: result.width,
    height: result.height,
    duration: result.duration,
  };
}
