import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/transcode/pipelines/video-mp4', () => ({
  processVideoMp4: vi.fn(),
}));

import { processVideoMp4 } from '../../src/lib/transcode/pipelines/video-mp4';
import { processJob } from '../../src/lib/transcode/worker/processor';

const mockProcessVideoMp4 = vi.mocked(processVideoMp4);

describe('transcode processor', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRANSCODE_DRY_RUN = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('routes supported video_mp4 jobs into the MP4 pipeline', async () => {
    const result = {
      variantR2Key: 'variants/media_123/video_mp4.mp4',
      variantR2Url: 'https://cdn.example.com/variants/media_123/video_mp4.mp4',
      fileSize: 1024,
      format: 'video/mp4',
    };
    mockProcessVideoMp4.mockResolvedValue(result);

    await expect(
      processJob(
        { id: 'job_123', mediaId: 'media_123', jobType: 'video_mp4' },
        '/tmp/job_123'
      )
    ).resolves.toEqual(result);

    expect(mockProcessVideoMp4).toHaveBeenCalledWith(
      { id: 'job_123', mediaId: 'media_123', jobType: 'video_mp4' },
      '/tmp/job_123'
    );
  });

  it('keeps dry-run limited to supported job types', async () => {
    process.env.TRANSCODE_DRY_RUN = 'true';

    await expect(
      processJob(
        { id: 'job_123', mediaId: 'media_123', jobType: 'video_mp4' },
        '/tmp/job_123'
      )
    ).resolves.toMatchObject({
      variantR2Key: 'variants/media_123/dry-run.mp4',
      format: 'video/mp4',
    });

    await expect(
      processJob(
        { id: 'job_456', mediaId: 'media_456', jobType: 'video_hevc' },
        '/tmp/job_456'
      )
    ).rejects.toThrow('Unsupported job type: video_hevc');
  });

  it('rejects unknown job types explicitly', async () => {
    await expect(
      processJob(
        { id: 'job_789', mediaId: 'media_789', jobType: 'unknown_type' },
        '/tmp/job_789'
      )
    ).rejects.toThrow('Unknown job type: unknown_type');
  });
});
