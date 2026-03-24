/**
 * Cloudflare R2 Storage Client
 * AWS S3 Compatible API를 사용하여 파일 업로드/삭제/조회를 처리합니다.
 */

import { Readable } from 'node:stream';

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 클라이언트 초기화
// Cloudflare R2는 AWS SDK v3의 체크섬 기능을 지원하지 않으므로 비활성화
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  // Cloudflare R2 호환성을 위해 체크섬 비활성화
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export interface UploadFileOptions {
  /** R2 object key (경로) */
  key: string;
  /** 파일 버퍼 */
  buffer: Buffer;
  /** MIME 타입 */
  contentType: string;
  /** 메타데이터 (선택사항) */
  metadata?: Record<string, string>;
}

export interface UploadFileResult {
  /** R2 object key */
  key: string;
  /** 공개 URL */
  url: string;
  /** 파일 크기 (bytes) */
  size: number;
}

/**
 * 파일을 R2에 업로드
 */
export async function uploadToR2(options: UploadFileOptions): Promise<UploadFileResult> {
  const { key, buffer, contentType, metadata } = options;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    })
  );

  const url = `${PUBLIC_URL}/${key}`;
  const size = buffer.length;

  return { key, url, size };
}

/**
 * R2에서 파일 삭제
 */
export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  );
}

/**
 * 파일 존재 여부 확인
 */
export async function checkFileExists(key: string): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Presigned URL 생성 (다운로드용)
 */
export async function getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Presigned URL 생성 (업로드용)
 * 클라이언트가 직접 R2에 파일을 업로드할 수 있도록 PUT용 Presigned URL 생성
 *
 * @param key - R2 object key (파일 경로)
 * @param contentType - MIME type (예: 'application/json', 'image/png')
 * @param expiresIn - URL 만료 시간 (초 단위, 기본값: 900초 = 15분)
 * @returns Presigned URL
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(r2Client, command, { expiresIn });
}

export interface R2Object {
  /** R2 object key */
  key: string;
  /** File size in bytes */
  size: number;
  /** Last modified date */
  lastModified: Date;
}

/**
 * List all files in R2 bucket
 * Handles pagination automatically
 *
 * @param prefix - Optional prefix to filter files (e.g., 'models/' or 'avatars/')
 * @param maxKeys - Maximum number of keys to return per request (default: 1000)
 * @returns Array of R2 objects
 */
export async function listR2Files(
  prefix?: string,
  maxKeys: number = 1000
): Promise<R2Object[]> {
  const allObjects: R2Object[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys,
      ContinuationToken: continuationToken,
    });

    const response = await r2Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Size !== undefined && obj.LastModified) {
          allObjects.push({
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified,
          });
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return allObjects;
}

/**
 * R2에서 파일 다운로드 (Buffer로 반환)
 *
 * @param key - R2 object key
 * @returns 파일 내용 Buffer
 */
export async function getR2Object(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await r2Client.send(command);

  if (!response.Body) {
    throw new Error(`Object not found: ${key}`);
  }

  // ReadableStream to Buffer
  const chunks: Uint8Array[] = [];
  const reader = response.Body.transformToWebStream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * R2에서 파일 다운로드 (Readable Stream 반환)
 *
 * @param key - R2 object key
 * @returns Node.js Readable stream
 */
export async function getR2ObjectStream(key: string): Promise<Readable> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await r2Client.send(command);

  if (!response.Body) {
    throw new Error(`Object not found: ${key}`);
  }

  const body = response.Body as unknown;

  if (body instanceof Readable) {
    return body;
  }

  if (body && typeof (body as { transformToWebStream?: () => ReadableStream }).transformToWebStream === 'function') {
    return Readable.fromWeb((body as { transformToWebStream: () => ReadableStream }).transformToWebStream() as import('stream/web').ReadableStream);
  }

  if (body && typeof (body as ReadableStream).getReader === 'function') {
    return Readable.fromWeb(body as import('stream/web').ReadableStream);
  }

  throw new Error(`Unsupported stream type for key: ${key}`);
}

/**
 * Delete multiple files from R2 in a single request
 * More efficient than deleting one by one
 *
 * @param keys - Array of object keys to delete
 * @returns Object with deleted and error counts
 */
export async function deleteMultipleFromR2(keys: string[]): Promise<{
  deleted: number;
  errors: number;
}> {
  if (keys.length === 0) {
    return { deleted: 0, errors: 0 };
  }

  // S3 allows max 1000 objects per delete request
  const batchSize = 1000;
  let totalDeleted = 0;
  let totalErrors = 0;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    const command = new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: batch.map((key) => ({ Key: key })),
        Quiet: false,
      },
    });

    const response = await r2Client.send(command);

    totalDeleted += response.Deleted?.length ?? 0;
    totalErrors += response.Errors?.length ?? 0;
  }

  return { deleted: totalDeleted, errors: totalErrors };
}
