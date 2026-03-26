/**
 * Transcode Worker Entry Point
 * Run: tsx scripts/transcode-worker.ts
 * Or via Docker: docker compose up -d --build
 *
 * Loads environment, validates config, registers signal handlers,
 * then starts the worker loop.
 */

import { config } from 'dotenv';

// Load .env.worker first (Docker/production), fall back to .env.local (local dev)
config({ path: '.env.worker' });
config({ path: '.env.local' });

// ============================================================================
// Environment Validation (before any app imports)
// ============================================================================

function validateEnvironment(): void {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[WORKER] DATABASE_URL is required');
    process.exit(1);
  }

  if (process.env.TRANSCODE_PIPELINE_ENABLED !== 'true') {
    console.error('[WORKER] TRANSCODE_PIPELINE_ENABLED is not "true". Exiting.');
    process.exit(1);
  }

  // Safety: warn if connecting to remote Railway instance
  if (dbUrl.includes('railway.app') && process.env.TRANSCODE_ALLOW_REMOTE_DB !== 'true') {
    console.warn(
      '[WORKER] WARNING: DATABASE_URL points to a remote Railway instance.\n' +
      '  Set TRANSCODE_ALLOW_REMOTE_DB=true to confirm this is intentional.\n' +
      '  Exiting for safety.'
    );
    process.exit(1);
  }

  if (process.env.TRANSCODE_DRY_RUN === 'true') {
    console.log('[WORKER] DRY-RUN mode enabled — ffmpeg/R2 operations will be skipped');
  }

  console.log('[WORKER] Environment validated');
}

validateEnvironment();

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Dynamic import after env validation to ensure DATABASE_URL is set
  const { start, stop } = await import('../src/lib/transcode/worker/runner');

  // Register signal handlers for graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[WORKER] Received ${signal}`);
    await stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start the worker loop
  await start();
}

main().catch((err) => {
  console.error('[WORKER] Fatal error:', err);
  process.exit(1);
});
