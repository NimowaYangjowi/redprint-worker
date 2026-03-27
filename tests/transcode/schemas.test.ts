import { describe, expect, it } from 'vitest';

import {
  enqueueRequestSchema,
  jobTypeSchema,
  variantTypeSchema,
} from '../../src/lib/transcode/schemas';

describe('transcode schemas', () => {
  it('accepts the implemented video_mp4 job type', () => {
    expect(jobTypeSchema.parse('video_mp4')).toBe('video_mp4');
    expect(variantTypeSchema.parse('video_mp4')).toBe('video_mp4');
    expect(
      enqueueRequestSchema.parse({
        mediaId: 'media_123',
        jobType: 'video_mp4',
      })
    ).toEqual({
      mediaId: 'media_123',
      jobType: 'video_mp4',
    });
  });

  it('rejects video_hevc until the pipeline exists end-to-end', () => {
    expect(() => jobTypeSchema.parse('video_hevc')).toThrow();
    expect(() => variantTypeSchema.parse('video_hevc')).toThrow();
    expect(() =>
      enqueueRequestSchema.parse({
        mediaId: 'media_123',
        jobType: 'video_hevc',
      })
    ).toThrow();
  });
});
