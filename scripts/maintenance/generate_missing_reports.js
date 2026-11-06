// File: scripts/maintenance/generate_missing_reports.js
//
// Generate report URLs for requests that never got one — typically after a
// snapshot-reports outage, during which createReport failed and the error was
// swallowed so the request itself would not fail.
//
// This is a PATCH tool, not part of the normal flow. It only ever adds a
// missing report URL; it never replaces an existing one and never re-runs the
// analysis. Deciding whether a given request should be patched at all (cached?
// demo? stale?) is the operator's job — start with --dry-run and read the list.
//
// Scope (exactly one required):
//   --request <32-hex>   a single request
//   --user <userId>      every request of one user
//   --all                every request, all users
//
// Options:
//   --apply              actually write (default is DRY-RUN, read-only)
//   --limit <n>          stop after n candidate requests
//   --report-kind <kind> override the owning user's reports.defaultVersion
//   --json               print the raw result object instead of a table
//   --help
//
// Examples:
//   node scripts/maintenance/generate_missing_reports.js --all
//   node scripts/maintenance/generate_missing_reports.js --user acme --apply
//   node scripts/maintenance/generate_missing_reports.js --request 16d2… --apply

const { backfillReportUrls, Outcome } = require('../../src/utils/reportBackfiller');

const USAGE = `
Usage: node scripts/maintenance/generate_missing_reports.js <scope> [options]

Scope (exactly one):
  --request <32-hex>    Patch a single request
  --user <userId>       Patch every request owned by that user
  --all                 Patch every request, all users

Options:
  --apply               Write the changes (default: dry run, nothing is written)
  --limit <n>           Process at most n candidate requests
  --report-kind <kind>  Use this report kind instead of the user's default
  --json                Print the raw JSON result
  --help                Show this message
`;

const parseArgs = (argv) => {
  const args = {
    requestId: null,
    userId: null,
    all: false,
    dryRun: true,
    limit: null,
    reportKind: null,
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--request':
        args.requestId = argv[++i];
        break;
      case '--user':
        args.userId = argv[++i];
        break;
      case '--all':
        args.all = true;
        break;
      case '--apply':
        args.dryRun = false;
        break;
      case '--limit':
        args.limit = parseInt(argv[++i], 10);
        break;
      case '--report-kind':
        args.reportKind = argv[++i];
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const OUTCOME_LABEL = {
  [Outcome.CREATED]: 'CREATED',
  [Outcome.WOULD_CREATE]: 'WOULD CREATE',
  [Outcome.SKIPPED_HAS_REPORT]: 'skip (has report)',
  [Outcome.SKIPPED_NO_REPORT_KIND]: 'skip (no report kind)',
  [Outcome.SKIPPED_UNKNOWN_USER]: 'skip (unknown user)',
  [Outcome.SKIPPED_NO_GENSHARE_RESPONSE]: 'skip (no genshare response)',
  [Outcome.FAILED]: 'FAILED'
};

const printReport = (summary) => {
  const mode = summary.dry_run ? 'DRY RUN — nothing was written' : 'APPLIED';
  console.log(`\nScope: ${summary.scope}   Mode: ${mode}`);
  console.log(`Candidates scanned: ${summary.scanned}\n`);

  if (summary.results.length === 0) {
    console.log('No request is missing a report URL for this scope.\n');
    return;
  }

  for (const result of summary.results) {
    const label = OUTCOME_LABEL[result.outcome] || result.outcome;
    console.log(`${result.request_id}  ${result.user_id.padEnd(20)}  ${label}`);
    if (result.report_url) console.log(`    url: ${result.report_url}`);
    if (result.reason) console.log(`    reason: ${result.reason}`);
  }

  console.log(
    `\nCreated: ${summary.created}   Would create: ${summary.would_create}   ` +
      `Skipped: ${summary.skipped}   Failed: ${summary.failed}`
  );

  if (summary.dry_run && summary.would_create > 0) {
    console.log('\nRe-run with --apply to create these report URLs.');
  }
  console.log('');
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(USAGE);
    return;
  }

  try {
    const summary = await backfillReportUrls({
      requestId: args.requestId,
      userId: args.userId,
      all: args.all,
      dryRun: args.dryRun,
      limit: args.limit,
      reportKind: args.reportKind
    });

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printReport(summary);
    }

    // Non-zero when at least one request could not be patched, so a scripted
    // run after an outage fails loudly instead of looking clean.
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
  }
};

// Several managers pulled in above call watchConfig(), which installs fs.watch
// handles that keep the event loop alive forever. That is what the server
// wants; a one-shot script must exit instead. Force it once main() has settled,
// preserving whatever exit code main() decided on.
main().finally(() => {
  // eslint-disable-next-line n/no-process-exit
  process.exit(process.exitCode || 0);
});
