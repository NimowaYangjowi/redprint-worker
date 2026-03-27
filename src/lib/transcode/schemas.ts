/**
 * Transcode Pipeline Zod Schemas
 * Validation schemas for transcode job types and variant types.
 */

import { z } from 'zod';

/** Valid job types for transcoding */
export const jobTypeSchema = z.enum(['video_mp4']);
export type JobTypeInput = z.infer<typeof jobTypeSchema>;

/** Valid variant types */
export const variantTypeSchema = z.enum(['video_mp4']);
export type VariantTypeInput = z.infer<typeof variantTypeSchema>;

/** Transcode status for asset_media denormalized column */
export const transcodeStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']).nullable();
export type TranscodeStatusInput = z.infer<typeof transcodeStatusSchema>;

/** Enqueue request validation */
export const enqueueRequestSchema = z.object({
  mediaId: z.string().min(1),
  jobType: jobTypeSchema,
});

/** Complete request validation — variant metadata */
export const completeRequestSchema = z.object({
  jobId: z.string().min(1),
  variantR2Key: z.string().min(1),
  variantR2Url: z.string().min(1),
  fileSize: z.number().int().positive(),
  format: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
});
