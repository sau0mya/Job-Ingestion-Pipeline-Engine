const cron = require('node-cron');
const runner = require('./scraper/runner');

// Retrieve interval from environment configuration (default 15 minutes)
const intervalMinutes = parseInt(process.env.FETCH_INTERVAL_MINUTES, 10) || 15;

// Build cron expression (e.g., */15 * * * *)
const cronExpression = `*/${intervalMinutes} * * * *`;

let cronJob = null;

/**
 * Initializes and starts the scheduler.
 * Runs one cycle immediately on startup, then schedules periodic runs.
 */
function startScheduler() {
  console.log(`[Scheduler] Initializing cron job to execute every ${intervalMinutes} minutes: "${cronExpression}"`);

  // 1. Schedule periodic execution
  cronJob = cron.schedule(cronExpression, async () => {
    console.log('[Scheduler] Cron trigger activated. Launching ingestion cycle...');
    try {
      await runner.run();
    } catch (err) {
      console.error('[Scheduler] Ingestion cycle threw an unhandled exception:', err);
    }
  });

  // 2. Fire immediate ingestion run on startup (async, do not block server startup thread)
  console.log('[Scheduler] Triggering immediate initialization run...');
  (async () => {
    try {
      await runner.run();
    } catch (err) {
      console.error('[Scheduler] Initial run failed:', err);
    }
  })();
}

/**
 * Stops the scheduler (useful for unit tests and clean process teardown).
 */
function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    console.log('[Scheduler] Periodic scheduler stopped.');
  }
}

module.exports = {
  startScheduler,
  stopScheduler
};
