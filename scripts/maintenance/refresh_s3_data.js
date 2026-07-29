// File: scripts/maintenance/refresh_s3_data.js
//
// S3 migration / audit for snapshot-api per-request folders. For every
// `<folder>/<userId>/<requestId>/` under the configured S3 prefix, this
// script:
//
//   - Splits legacy wrapped genshare/response.json into
//     genshare/response.json (slim live view) + genshare/response.original.json
//     (full immutable payload), or copies the slim file into the original slot
//     when there's no legacy payload to split from.
//   - Backfills response.original.json from response.json when missing.
//   - Injects `hashes` ({ demo, cache }) and `result` ({ status, error })
//     into process.json non-destructively.
//   - Optionally (with --rehash) downloads the main PDF, computes SHA-256,
//     and writes it into files/file_<N>.metadata.json — S3 only, never the
//     DB. DB backfill happens separately via `npm run db:refresh`.
//
// Never touches: process.log, report/report.json, cache-ref.json,
// genshare/request.json, _cache/*.
//
// Default is DRY-RUN (read-only): classifies every folder, prints the
// plan, writes a report, but does not call PutObject / getFileBuffer.
// Use --apply to actually write.

const fs = require('fs');
const path = require('path');

const { uploadBatchToS3 } = require('../../src/utils/s3Storage');
const refresher = require('../../src/utils/s3DataRefresher');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const args = {
    user: null,
    request: null,
    since: null,
    limit: null,
    apply: false,
    dryRun: true,
    rehash: false,
    skip: new Set(),
    report: null,
    concurrency: 10,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--user':
        args.user = next;
        i++;
        break;
      case '--request':
        args.request = next;
        i++;
        break;
      case '--since':
        args.since = next;
        i++;
        break;
      case '--limit':
        args.limit = parseInt(next, 10);
        i++;
        break;
      case '--apply':
        args.apply = true;
        args.dryRun = false;
        break;
      case '--dry-run':
      case '--audit':
        args.dryRun = true;
        args.apply = false;
        break;
      case '--rehash':
        args.rehash = true;
        break;
      case '--skip':
        if (next) {
          next.split(',').forEach((s) => args.skip.add(s.trim()));
          i++;
        }
        break;
      case '--report':
        args.report = next;
        i++;
        break;
      case '--concurrency':
        args.concurrency = Math.max(1, parseInt(next, 10) || 10);
        i++;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        if (arg && arg.startsWith('--')) {
          console.warn(`[refresh_s3_data] Unknown flag: ${arg}`);
        }
    }
  }
  return args;
};

const printHelp = () => {
  console.log(`
Usage: node scripts/maintenance/refresh_s3_data.js [options]

Options:
  --user <userId>           Only process requests owned by this user
  --request <requestId>     Only process this single request (requires --user)
  --since <YYYY-MM-DD>      Only process requests with a process.json.startDate
                            at or after this date (best-effort filter)
  --limit <N>               Stop after N requests

  --dry-run   (default)     Classify only — do NOT write anything to S3.
  --audit                   Alias for --dry-run.
  --apply                   Enable writes. Required for any S3 modification.

  --rehash                  Also download each main PDF to compute SHA-256 and
                            store it in files/file_<N>.metadata.json. Skipped
                            entirely in --dry-run. S3 only — no DB writes.

  --skip <steps>            Comma-separated list of steps to skip:
                              originals  skip Step A + B
                              hashes     skip process.json backfill
                              result     skip result field derivation
                              rehash     skip Step D (same as omitting --rehash)

  --report <path>           Write a structured JSON report to this path.
  --concurrency <N>         Per-batch parallelism (default 10).
  -h, --help                Show this message.
`);
};

// ---------------------------------------------------------------------------
// Per-request pipeline
// ---------------------------------------------------------------------------

/**
 * Process a single request folder. Pure planning + optional writes.
 * Returns a record that the caller collects into the overall report.
 */
const processRequest = async (folder, opts) => {
  const startedAt = Date.now();
  const record = {
    user_id: folder.userId,
    request_id: folder.requestId,
    status: 'ok',
    actions: [],
    warnings: [],
    errors: [],
    duration_ms: 0
  };

  let inv;
  try {
    inv = await refresher.readRequestInventory(folder.userId, folder.requestId);
  } catch (error) {
    record.status = 'error';
    record.errors.push(`inventory: ${error.message}`);
    record.duration_ms = Date.now() - startedAt;
    return record;
  }

  // --since filter (best-effort via process.json.startDate)
  if (opts.since && inv.process && typeof inv.process.startDate === 'string') {
    if (inv.process.startDate < opts.since) {
      record.status = 'skip';
      record.actions.push('skip:before-since');
      record.duration_ms = Date.now() - startedAt;
      return record;
    }
  }

  const allWrites = [];

  // ---------- Step A: genshare/response.original.json ----------
  if (!opts.skip.has('originals')) {
    const plan = refresher.planGenshareOriginals(inv);
    if (plan) {
      if (plan.warnings.length) record.warnings.push(...plan.warnings);
      if (plan.kind) {
        record.actions.push(`migrated:${plan.kind}`);
        allWrites.push(...plan.writes);
      }
    }
  }

  // ---------- Step B: response.original.json (root) ----------
  if (!opts.skip.has('originals')) {
    const plan = refresher.planRootOriginals(inv);
    if (plan) {
      if (plan.warnings.length) record.warnings.push(...plan.warnings);
      record.actions.push(`migrated:${plan.kind}`);
      allWrites.push(...plan.writes);
    }
  }

  // ---------- Step D: PDF rehash (runs before Step C so Step C can pick up the fresh hash) ----------
  let freshPdfSha256 = null;
  if (opts.rehash && !opts.skip.has('rehash')) {
    if (opts.apply) {
      try {
        const plan = await refresher.planPdfRehash(inv);
        if (plan) {
          if (plan.warnings.length) record.warnings.push(...plan.warnings);
          if (plan.kind === 'rehashed' && plan.writes.length > 0) {
            // Rehash writes are applied immediately so Step C sees the fresh
            // hash without a second read.
            await uploadBatchToS3(plan.writes);
            record.actions.push('rehashed');
            freshPdfSha256 = plan.hash;
          }
        }
      } catch (error) {
        record.errors.push(`rehash: ${error.message}`);
      }
    } else {
      // In dry-run we only flag that a rehash WOULD happen if metadata lacks sha256.
      try {
        const { metadata } = await refresher.readMainFileMetadata(inv);
        if (!metadata || !metadata.sha256) {
          record.actions.push('would-rehash');
        }
      } catch (error) {
        record.warnings.push(`rehash-probe: ${error.message}`);
      }
    }
  }

  // ---------- Step C: process.json hashes + result ----------
  if (!opts.skip.has('hashes') || !opts.skip.has('result')) {
    try {
      const plan = await refresher.planProcessJsonUpdate(inv, {
        freshPdfSha256
      });
      if (plan) {
        if (plan.warnings.length) record.warnings.push(...plan.warnings);
        if (plan.changedHashes && !opts.skip.has('hashes')) {
          record.actions.push('process-updated:hashes');
        }
        if (plan.changedResult && !opts.skip.has('result')) {
          record.actions.push('process-updated:result');
        }
        // If the operator skipped one dimension but not the other, we still
        // write the unified file — the skipped dimension just carries its
        // previous value.
        if (
          (plan.changedHashes && !opts.skip.has('hashes')) ||
          (plan.changedResult && !opts.skip.has('result'))
        ) {
          allWrites.push(...plan.writes);
        }
      }
    } catch (error) {
      record.errors.push(`process-update: ${error.message}`);
    }
  }

  // ---------- Flush writes (only in --apply) ----------
  if (allWrites.length > 0) {
    if (opts.apply) {
      try {
        await uploadBatchToS3(allWrites);
      } catch (error) {
        record.status = 'error';
        record.errors.push(`upload: ${error.message}`);
      }
    } else {
      // Dry-run: list planned writes for visibility
      record.actions.push(`would-write:${allWrites.length}`);
    }
  }

  if (record.actions.length === 0) {
    record.status = 'noop';
  }
  if (record.errors.length > 0) {
    record.status = 'error';
  }
  record.duration_ms = Date.now() - startedAt;
  return record;
};

// ---------------------------------------------------------------------------
// Batch driver
// ---------------------------------------------------------------------------

const runInBatches = async (items, concurrency, handler, onDone) => {
  const results = [];
  let idx = 0;
  while (idx < items.length) {
    const batch = items.slice(idx, idx + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map(handler));
    for (const r of batchResults) {
      results.push(r);
      if (onDone) onDone(r, results.length, items.length);
    }
    idx += concurrency;
  }
  return results;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const summarize = (records) => {
  const summary = {
    total: records.length,
    ok: 0,
    noop: 0,
    skip: 0,
    error: 0,
    actions: {},
    warnings: 0,
    errors: 0
  };
  for (const r of records) {
    if (summary[r.status] !== undefined) summary[r.status] += 1;
    for (const a of r.actions) {
      summary.actions[a] = (summary.actions[a] || 0) + 1;
    }
    summary.warnings += r.warnings.length;
    summary.errors += r.errors.length;
  }
  return summary;
};

const formatSummary = (summary) => {
  const lines = [];
  lines.push('');
  lines.push('──── SUMMARY ────');
  lines.push(`Total requests:     ${summary.total}`);
  lines.push(`  ok (wrote):       ${summary.ok}`);
  lines.push(`  noop (no-op):     ${summary.noop}`);
  lines.push(`  skip (filtered):  ${summary.skip}`);
  lines.push(`  error:            ${summary.error}`);
  lines.push(`Warnings:           ${summary.warnings}`);
  lines.push(`Errors:             ${summary.errors}`);
  if (Object.keys(summary.actions).length > 0) {
    lines.push('Actions:');
    const sorted = Object.entries(summary.actions).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      lines.push(`  ${count.toString().padStart(6)} × ${name}`);
    }
  }
  return lines.join('\n');
};

const main = async () => {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[refresh_s3_data] mode=${mode} rehash=${opts.rehash} concurrency=${opts.concurrency}`);
  if (opts.since) console.log(`[refresh_s3_data] since=${opts.since}`);
  if (opts.user) console.log(`[refresh_s3_data] user=${opts.user}`);
  if (opts.request) console.log(`[refresh_s3_data] request=${opts.request}`);
  if (opts.limit) console.log(`[refresh_s3_data] limit=${opts.limit}`);
  if (opts.skip.size > 0) console.log(`[refresh_s3_data] skip=${[...opts.skip].join(',')}`);

  // ---------- Discover folders ----------
  let folders;
  if (opts.user && opts.request) {
    folders = [{ userId: opts.user, requestId: opts.request }];
    console.log(`[refresh_s3_data] targeting single request ${opts.user}/${opts.request}`);
  } else {
    console.log('[refresh_s3_data] discovering request folders (prefix walk)...');
    folders = await refresher.listAllRequestFolders();
    if (opts.user) folders = folders.filter((f) => f.userId === opts.user);
    if (opts.limit && folders.length > opts.limit) folders = folders.slice(0, opts.limit);
    console.log(`[refresh_s3_data] discovered ${folders.length} request folder(s)`);
  }

  // ---------- Process ----------
  const records = await runInBatches(folders, opts.concurrency, (f) => processRequest(f, opts), (record, done, total) => {
    const actions = record.actions.length ? ` [${record.actions.join(' ')}]` : '';
    const warn = record.warnings.length ? ` (warn:${record.warnings.length})` : '';
    const err = record.errors.length ? ` (err:${record.errors.length})` : '';
    console.log(`[${done}/${total}] ${record.user_id}/${record.request_id} ${record.status}${actions}${warn}${err}`);
  });

  const summary = summarize(records);
  console.log(formatSummary(summary));

  // ---------- Report ----------
  if (opts.report) {
    try {
      const reportDir = path.dirname(opts.report);
      if (reportDir && !fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      const payload = {
        generated_at: new Date().toISOString(),
        mode,
        options: {
          rehash: opts.rehash,
          user: opts.user,
          request: opts.request,
          since: opts.since,
          limit: opts.limit,
          skip: [...opts.skip],
          concurrency: opts.concurrency
        },
        summary,
        records
      };
      fs.writeFileSync(opts.report, JSON.stringify(payload, null, 2));
      console.log(`[refresh_s3_data] report written to ${opts.report}`);
    } catch (error) {
      console.error(`[refresh_s3_data] failed to write report: ${error.message}`);
    }
  }
};

main().catch((error) => {
  console.error('[refresh_s3_data] fatal error:', error);
  process.exitCode = 1;
});
