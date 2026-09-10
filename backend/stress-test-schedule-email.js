/**
 * Stress test for the scheduling-sheet email fan-out.
 *
 * Sends N messages from the shared sender mailbox through the EXACT pipeline
 * POST /api/scheduling-sheets/:id/email uses — settleWithConcurrency at the
 * Graph per-mailbox ceiling, withGraphRetry around each emailService.sendEmail
 * — and reports what Graph actually did: per-send status, latency, how many
 * sends were throttled and recovered by retry, and the in-flight high-water
 * mark. Nothing here touches a sheet or a database document; it exercises
 * ONLY the transport, which is the part with external limits.
 *
 * It sends REAL email. Every message goes to --to (or to the system-settings
 * redirect address, exactly as production would), so point it at your own
 * inbox. Delivery disabled in system settings is honoured and reported as
 * 'skipped', same as the endpoint.
 *
 * Run (from backend/):
 *   node stress-test-schedule-email.js --to you@emanuelnyc.org               # 40 sends, window of 4
 *   node stress-test-schedule-email.js --to you@emanuelnyc.org --count 60 --attachment-kb 800
 *   node stress-test-schedule-email.js --to you@emanuelnyc.org --concurrency 40   # reproduce the old stampede
 *   node stress-test-schedule-email.js --to you@emanuelnyc.org --dry-run      # print the plan, send nothing
 *
 * --attachment-kb attaches that many KB of random bytes to EVERY message,
 * mirroring the workbook PDF that rides on every recipient's email. Keep it
 * under 3072 (the endpoint's MAX_SCHEDULE_ATTACHMENT_BYTES).
 */

const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const path = require('path');
// Always backend/.env, whatever the caller's cwd: run from the repo root this
// would otherwise pick up the root .env, which has no email settings at all.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const emailService = require('./services/emailService');
const { withGraphRetry } = require('./utils/graphRetry');
const { settleWithConcurrency } = require('./utils/settleWithConcurrency');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const TO = arg('to', null);
const COUNT = parseInt(arg('count', '40'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '4'), 10);
const ATTACHMENT_KB = parseInt(arg('attachment-kb', '0'), 10);
const DRY_RUN = process.argv.includes('--dry-run');

if (!TO || TO === true) {
  console.error('Usage: node stress-test-schedule-email.js --to <address> [--count 40] [--concurrency 4] [--attachment-kb 0] [--dry-run]');
  process.exit(1);
}

async function main() {
  // Same settings resolution as production: DB overrides ENV, so a redirect
  // or a disabled switch in System Settings applies here too.
  let client = null;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    emailService.setDbConnection(client.db(DB_NAME));
  } catch (e) {
    console.warn(`Could not connect to MongoDB (${e.message}); using ENV email settings only.`);
  }
  const settings = await emailService.getEffectiveSettings();

  const attachment = ATTACHMENT_KB > 0
    ? {
      name: 'stress-test-attachment.bin',
      contentType: 'application/octet-stream',
      contentBase64: crypto.randomBytes(ATTACHMENT_KB * 1024).toString('base64')
    }
    : null;

  console.log('Schedule email stress test');
  console.log(`   to:            ${TO}${settings.redirectTo ? `  (redirected to ${settings.redirectTo} by settings)` : ''}`);
  console.log(`   delivery:      ${settings.enabled ? 'enabled' : 'DISABLED in settings (sends will be reported as skipped)'}`);
  console.log(`   messages:      ${COUNT}`);
  console.log(`   concurrency:   ${CONCURRENCY}`);
  console.log(`   attachment:    ${attachment ? `${ATTACHMENT_KB} KB on every message` : 'none'}`);
  if (DRY_RUN) {
    console.log('   --dry-run: nothing sent.');
    if (client) await client.close();
    return;
  }

  const runId = new Date().toISOString();
  let inFlight = 0;
  let highWater = 0;
  let retries = 0;
  const started = Date.now();

  const settled = await settleWithConcurrency(
    Array.from({ length: COUNT }, (_, i) => i + 1),
    CONCURRENCY,
    async (n) => {
      inFlight++;
      highWater = Math.max(highWater, inFlight);
      const t0 = Date.now();
      try {
        const outcome = await withGraphRetry(
          () => emailService.sendEmail(
            TO,
            `[Stress test ${runId}] message ${n} of ${COUNT}`,
            `<p>Stress test message ${n} of ${COUNT}, run ${runId}. Safe to delete.</p>`,
            { reservationId: `stress-${runId}`, ...(attachment ? { attachments: [attachment] } : {}) }
          ),
          {
            onRetry: ({ attempt, delay, error }) => {
              retries++;
              console.log(`   #${n}: attempt ${attempt} got ${error.status || error.code || error.message}; retrying in ${delay}ms`);
            }
          }
        );
        return { n, ms: Date.now() - t0, skipped: !!(outcome && outcome.skipped) };
      } finally {
        inFlight--;
        process.stdout.write(`\r   [Progress] ${n}/${COUNT}`);
      }
    }
  );
  process.stdout.write('\n');

  const elapsed = Date.now() - started;
  const ok = settled.filter((s) => s.status === 'fulfilled' && !s.value.skipped);
  const skipped = settled.filter((s) => s.status === 'fulfilled' && s.value.skipped);
  const failed = settled.filter((s) => s.status === 'rejected');
  const latencies = ok.map((s) => s.value.ms).sort((a, b) => a - b);
  const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : 0);

  console.log('');
  console.log('Summary');
  console.log(`   sent:          ${ok.length}`);
  console.log(`   skipped:       ${skipped.length}`);
  console.log(`   failed:        ${failed.length}`);
  console.log(`   retries:       ${retries}  (throttled or transient sends recovered by withGraphRetry)`);
  console.log(`   in flight max: ${highWater}`);
  console.log(`   elapsed:       ${(elapsed / 1000).toFixed(1)}s  (${(elapsed / Math.max(1, COUNT)).toFixed(0)}ms per message wall-clock)`);
  if (latencies.length) {
    console.log(`   latency:       p50 ${pct(0.5)}ms  p90 ${pct(0.9)}ms  max ${latencies[latencies.length - 1]}ms`);
  }
  for (const f of failed) {
    const err = f.reason || {};
    console.log(`   FAILED: ${err.status ? `HTTP ${err.status} ` : ''}${err.message}`);
  }

  if (client) await client.close();
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error('Stress test crashed:', e);
  process.exit(1);
});
