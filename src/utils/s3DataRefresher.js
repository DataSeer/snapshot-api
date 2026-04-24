// File: src/utils/s3DataRefresher.js
//
// Helpers used by scripts/maintenance/refresh_s3_data.js to migrate legacy
// request folders in S3 to the current layout:
//
//   <folder>/<userId>/<requestId>/
//     genshare/response.json          → slim { response: [...] } (live view)
//     genshare/response.original.json → full immutable genshare payload
//     response.json                   → filtered response (client-facing)
//     response.original.json          → filtered response (immutable copy)
//     process.json                    → session metadata + hashes + result
//
// This module is read-only except for a few exported "plan" helpers that
// build the write operations the script will eventually submit via
// uploadBatchToS3. The script itself is responsible for gating the writes
// behind --apply.

const crypto = require('crypto');
const {
  listObjects,
  getFile,
  getFileBuffer,
  s3Config
} = require('./s3Storage');

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

const sha256OfBuffer = (buffer) => {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
};

const tryGetJson = async (key) => {
  try {
    const raw = await getFile(key);
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
};

const tryGetText = async (key) => {
  try {
    const raw = await getFile(key);
    return raw || '';
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return '';
    }
    throw error;
  }
};

/**
 * List every <userId>/<requestId>/ pair under s3Folder by pure prefix walk.
 * Does NOT gate on the presence of genshare/request.json — picks up folders
 * that never reached genshare.
 */
const listAllRequestFolders = async () => {
  const prefix = `${s3Config.s3Folder}/`;
  const objects = await listObjects(prefix);
  const seen = new Set();
  const folders = [];
  for (const obj of objects) {
    // obj.Key looks like: `${s3Folder}/userId/requestId/<tail>`
    const withoutFolder = obj.Key.slice(prefix.length);
    const parts = withoutFolder.split('/');
    if (parts.length < 2) continue;
    const [userId, requestId] = parts;
    if (!userId || !requestId) continue;
    // Skip the cache prefix — cache entries don't have a userId/requestId.
    if (userId === '_cache') continue;
    const key = `${userId}/${requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push({ userId, requestId });
  }
  return folders;
};

// ---------------------------------------------------------------------------
// Shape classification
// ---------------------------------------------------------------------------

/**
 * Detect whether a parsed genshare/response.json payload is the new slim
 * shape ({ response: [...] }), the legacy wrapped shape
 * ({ status, headers, data: { response, path, score, … } }), or corrupt.
 */
const classifyGenshareResponseShape = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return 'corrupt';
  if (Array.isArray(parsed.response)) return 'slim';
  if (parsed.data && typeof parsed.data === 'object') {
    if (Array.isArray(parsed.data.response)) return 'legacy';
  }
  return 'corrupt';
};

// ---------------------------------------------------------------------------
// Per-request inventory
// ---------------------------------------------------------------------------

const requestPath = (userId, requestId) =>
  `${s3Config.s3Folder}/${userId}/${requestId}`;

/**
 * Read the files we care about for a request folder and return a compact
 * inventory object. Every field may be null when the file is missing.
 */
const readRequestInventory = async (userId, requestId) => {
  const base = requestPath(userId, requestId);

  const [
    genshareResponseRaw,
    genshareResponseOriginalRaw,
    rootResponseRaw,
    rootResponseOriginalRaw,
    cacheRefRaw,
    processRaw,
    filesListRaw
  ] = await Promise.all([
    tryGetJson(`${base}/genshare/response.json`),
    tryGetJson(`${base}/genshare/response.original.json`),
    tryGetJson(`${base}/response.json`),
    tryGetJson(`${base}/response.original.json`),
    tryGetJson(`${base}/cache-ref.json`),
    tryGetJson(`${base}/process.json`),
    tryGetJson(`${base}/files.json`)
  ]);

  return {
    userId,
    requestId,
    base,
    genshareResponse: genshareResponseRaw,
    genshareResponseShape: genshareResponseRaw
      ? classifyGenshareResponseShape(genshareResponseRaw)
      : null,
    genshareResponseOriginal: genshareResponseOriginalRaw,
    rootResponse: rootResponseRaw,
    rootResponseOriginal: rootResponseOriginalRaw,
    cacheRef: cacheRefRaw,
    process: processRaw,
    filesList: filesListRaw
  };
};

/**
 * Resolve the 1-based index of the main (non-supplementary) PDF file.
 * Falls back to 1 when files.json is missing or has no fieldname info.
 */
const resolveMainFileIndex = (filesList) => {
  if (!Array.isArray(filesList) || filesList.length === 0) return 1;
  const main = filesList.find((f) => f && f.fieldname !== 'supplementary_file')
    || filesList[0];
  return main && typeof main.id === 'number' ? main.id : 1;
};

const resolveMainFileExtension = (filesList, fallbackName = null) => {
  const mainFile = Array.isArray(filesList)
    ? (filesList.find((f) => f && f.fieldname !== 'supplementary_file') || filesList[0])
    : null;
  const name = mainFile?.originalName || fallbackName || '';
  if (!name) return null;
  const parts = name.split('.');
  if (parts.length < 2) return null;
  return parts.pop();
};

// ---------------------------------------------------------------------------
// Migration planning
// ---------------------------------------------------------------------------

/**
 * Build the genshare-originals migration plan. Returns `null` when nothing
 * needs doing, otherwise an object describing the writes.
 *
 *   kind: 'genshare-legacy' | 'genshare-copy' | null
 *   writes: [{ key, data, contentType }, ...]
 *   warnings: string[]
 */
const planGenshareOriginals = (inv) => {
  const warnings = [];

  // Nothing to do: original already present
  if (inv.genshareResponseOriginal) return null;

  if (!inv.genshareResponse) {
    // Nothing to split / copy from
    return null;
  }

  if (inv.genshareResponseShape === 'legacy') {
    const fullPayload = inv.genshareResponse.data;
    if (!fullPayload || typeof fullPayload !== 'object') {
      warnings.push('genshare-legacy: .data missing or not an object');
      return { kind: null, writes: [], warnings };
    }
    const slim = {
      response: Array.isArray(fullPayload.response) ? fullPayload.response : []
    };
    return {
      kind: 'genshare-legacy',
      writes: [
        // Write original FIRST so a crash mid-run leaves data recoverable
        {
          key: `${inv.base}/genshare/response.original.json`,
          data: JSON.stringify(fullPayload, null, 2),
          contentType: 'application/json'
        },
        {
          key: `${inv.base}/genshare/response.json`,
          data: JSON.stringify(slim, null, 2),
          contentType: 'application/json'
        }
      ],
      warnings
    };
  }

  if (inv.genshareResponseShape === 'slim') {
    // Copy current slim as the original (degraded — we don't have the full
    // raw genshare payload, but this is the best we can do for these).
    return {
      kind: 'genshare-copy',
      writes: [
        {
          key: `${inv.base}/genshare/response.original.json`,
          data: JSON.stringify(inv.genshareResponse, null, 2),
          contentType: 'application/json'
        }
      ],
      warnings: [
        'genshare-copy: current response.json used as original (full genshare payload not recoverable)'
      ]
    };
  }

  // Corrupt / unknown
  warnings.push(`genshare corrupt: shape=${inv.genshareResponseShape || 'unknown'}`);
  return { kind: null, writes: [], warnings };
};

/**
 * Build the root-originals migration plan (duplicate response.json →
 * response.original.json when missing).
 */
const planRootOriginals = (inv) => {
  if (inv.rootResponseOriginal) return null;
  if (!inv.rootResponse) return null;
  return {
    kind: 'root-copy',
    writes: [
      {
        key: `${inv.base}/response.original.json`,
        data: JSON.stringify(inv.rootResponse, null, 2),
        contentType: 'application/json'
      }
    ],
    warnings: []
  };
};

/**
 * Derive a `result` value from existing S3 files, best-effort.
 * Returns an object { status, error } that can be merged into process.json.
 */
const deriveResultFromInventory = async (inv) => {
  // 1. Root response.json is the most authoritative source.
  const root = inv.rootResponse;
  if (root && typeof root === 'object') {
    if (root.status === 'error' || root.status === 'Error') {
      return { status: 'error', error: root.error || root.error_message || null };
    }
    if (typeof root.status === 'number') {
      if (root.status >= 200 && root.status < 300) {
        return { status: 'success', error: null };
      }
      if (root.status >= 400) {
        return {
          status: 'error',
          error: `HTTP ${root.status}${root.error ? ` — ${root.error}` : ''}`
        };
      }
    }
    if (root.status === 'Success' || root.status === 'success') {
      return { status: 'success', error: null };
    }
  }

  // 2. Legacy wrapped genshare/response.json.data.status
  if (inv.genshareResponse && inv.genshareResponseShape === 'legacy') {
    const legacyStatus = inv.genshareResponse.status;
    if (typeof legacyStatus === 'number') {
      if (legacyStatus >= 200 && legacyStatus < 300) {
        return { status: 'success', error: null };
      }
      if (legacyStatus >= 400) {
        return { status: 'error', error: `HTTP ${legacyStatus}` };
      }
    }
  }

  // 3. Last-resort scan of process.log
  const logKey = `${inv.base}/process.log`;
  let logText = '';
  try {
    logText = await tryGetText(logKey);
  } catch {
    logText = '';
  }
  if (logText) {
    const errMatch = logText.match(
      /\[API\]\s+Error processing request:\s+([^\n\r]+)/
    );
    if (errMatch) {
      return { status: 'error', error: errMatch[1].trim() };
    }
  }

  return { status: null, error: null };
};

/**
 * Compute the genshare cache_key referenced by this request, best-effort.
 */
const deriveCacheKey = (inv) => {
  if (inv.cacheRef && typeof inv.cacheRef.cache_key === 'string' && inv.cacheRef.cache_key) {
    return inv.cacheRef.cache_key;
  }
  const orig = inv.genshareResponseOriginal;
  if (orig && orig.cache && typeof orig.cache.key === 'string' && orig.cache.key) {
    return orig.cache.key;
  }
  if (
    inv.genshareResponse &&
    inv.genshareResponseShape === 'legacy' &&
    inv.genshareResponse.data &&
    inv.genshareResponse.data.cache &&
    typeof inv.genshareResponse.data.cache.key === 'string' &&
    inv.genshareResponse.data.cache.key
  ) {
    return inv.genshareResponse.data.cache.key;
  }
  return null;
};

/**
 * Read a file metadata JSON (file_<N>.metadata.json) — no side effects.
 */
const readMainFileMetadata = async (inv) => {
  const idx = resolveMainFileIndex(inv.filesList);
  const key = `${inv.base}/files/file_${idx}.metadata.json`;
  const metadata = await tryGetJson(key);
  return { index: idx, key, metadata };
};

/**
 * Build the process.json hashes+result backfill plan.
 *
 * @param {Object} inv - inventory
 * @param {Object} [opts]
 * @param {string} [opts.freshPdfSha256] - if the --rehash step just computed
 *   a hash for this request, pass it here so hashes.demo picks it up.
 */
const planProcessJsonUpdate = async (inv, opts = {}) => {
  if (!inv.process || typeof inv.process !== 'object') {
    return null; // no process.json to augment
  }

  const warnings = [];
  const current = inv.process;

  // hashes.demo: prefer freshly-computed → file metadata → null
  let demoHash = opts.freshPdfSha256 || null;
  if (!demoHash) {
    try {
      const { metadata } = await readMainFileMetadata(inv);
      if (metadata && typeof metadata.sha256 === 'string' && metadata.sha256) {
        demoHash = metadata.sha256;
      }
    } catch (error) {
      warnings.push(`read-metadata: ${error.message}`);
    }
  }

  // hashes.cache: from cache-ref or original genshare payload
  const cacheKey = deriveCacheKey(inv);

  // result: derive from existing artifacts
  const result = await deriveResultFromInventory(inv);

  const nextHashes = {
    demo: demoHash || null,
    cache: cacheKey || null
  };
  const nextResult = result || { status: null, error: null };

  // Merge non-destructively and detect whether anything actually changes.
  const currentHashes = current.hashes && typeof current.hashes === 'object'
    ? current.hashes
    : {};
  const currentResult = current.result && typeof current.result === 'object'
    ? current.result
    : {};

  const changedHashes =
    (currentHashes.demo || null) !== nextHashes.demo ||
    (currentHashes.cache || null) !== nextHashes.cache;
  const changedResult =
    (currentResult.status || null) !== nextResult.status ||
    (currentResult.error || null) !== nextResult.error;

  if (!changedHashes && !changedResult) return null;

  const next = {
    ...current,
    hashes: { ...currentHashes, ...nextHashes },
    result: { ...currentResult, ...nextResult }
  };

  return {
    kind: 'process-update',
    changedHashes,
    changedResult,
    writes: [
      {
        key: `${inv.base}/process.json`,
        data: JSON.stringify(next, null, 2),
        contentType: 'application/json'
      }
    ],
    warnings
  };
};

/**
 * Rehash the main PDF on S3: download, compute SHA-256, merge into the
 * existing metadata.json and return the new content + the computed hash.
 *
 * Does NOT touch the DB. Returns { hash, writes, warnings } — caller submits
 * the writes via uploadBatchToS3 (gated by --apply).
 */
const planPdfRehash = async (inv) => {
  const warnings = [];
  const { index, key: metaKey, metadata } = await readMainFileMetadata(inv);

  if (metadata && typeof metadata.sha256 === 'string' && metadata.sha256) {
    return null; // already hashed
  }

  const extension = resolveMainFileExtension(
    inv.filesList,
    metadata?.originalName
  );
  if (!extension) {
    warnings.push('rehash: could not derive PDF extension');
    return { kind: null, writes: [], warnings, hash: null };
  }

  const pdfKey = `${inv.base}/files/file_${index}.${extension}`;
  let buffer;
  try {
    buffer = await getFileBuffer(pdfKey);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      warnings.push(`rehash: PDF not found at ${pdfKey}`);
      return { kind: null, writes: [], warnings, hash: null };
    }
    warnings.push(`rehash: failed to download PDF: ${error.message}`);
    return { kind: null, writes: [], warnings, hash: null };
  }

  const hash = sha256OfBuffer(buffer);
  buffer = null; // drop the buffer asap

  const nextMetadata = { ...(metadata || {}), sha256: hash };
  return {
    kind: 'rehashed',
    hash,
    writes: [
      {
        key: metaKey,
        data: JSON.stringify(nextMetadata, null, 2),
        contentType: 'application/json'
      }
    ],
    warnings
  };
};

module.exports = {
  // Low-level
  sha256OfBuffer,
  tryGetJson,
  tryGetText,
  // Discovery
  listAllRequestFolders,
  // Classification
  classifyGenshareResponseShape,
  // Inventory
  readRequestInventory,
  readMainFileMetadata,
  resolveMainFileIndex,
  resolveMainFileExtension,
  // Planning
  planGenshareOriginals,
  planRootOriginals,
  planProcessJsonUpdate,
  planPdfRehash,
  deriveResultFromInventory,
  deriveCacheKey
};
