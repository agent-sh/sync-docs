/**
 * Analyzer Queries Collector
 *
 * Runs the agent-analyzer `repo-intel query ...` commands we consume and
 * returns them as a single indexed bundle. Replaces the per-file regex +
 * git-show path in docs-patterns.js with the analyzer's symbol table and
 * slop-fix outputs, both of which are deterministic and cross-language.
 *
 * All queries degrade gracefully: if the binary is missing or the map
 * file isn't present, each field is `null` and the reason is recorded on
 * the bundle. Callers should treat `null` as "signal unavailable" and
 * skip the corresponding checks rather than invent fallback data.
 *
 * @module lib/collectors/analyzer-queries
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_OPTIONS = {
  cwd: process.cwd()
};

// Docs that `doc-drift` flags as uncoupled by design. These are never
// expected to co-change with code (Docusaurus snapshots, test fixtures,
// generated rule pages, CHANGELOG is append-only). Matching these is
// not evidence of drift; they're just not part of the live doc surface.
const DEFAULT_DOC_DRIFT_IGNORE = [
  /(^|\/)versioned_docs\//,
  /(^|\/)versioned_sidebars\//,
  /(^|\/)tests\/fixtures\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)generated\//,
  /\.generated\.md$/,
  /(^|\/)CHANGELOG\.md$/i,
  /(^|\/)node_modules\//,
  /(^|\/)target\//,
  /(^|\/)dist\//,
  /(^|\/)build\//
];

function resolveStateDir(cwd) {
  for (const dir of ['.claude', '.opencode', '.codex']) {
    if (fs.existsSync(path.join(cwd, dir))) {
      return dir;
    }
  }
  return '.claude';
}

function resolveMapFile(cwd) {
  return path.join(cwd, resolveStateDir(cwd), 'repo-intel.json');
}

/**
 * Get the agent-analyzer binary runner. On main the binary is vendored
 * at `lib/binary`; once the agentsys resolver PR lands this will switch
 * to `../agentsys`. Returns `null` when unavailable — callers should
 * treat the bundle as empty rather than erroring out.
 */
function getBinary() {
  try {
    // Prefer the agentsys resolver when present (post PR #21)
    const { binary } = require('../agentsys').get();
    if (binary) return binary;
  } catch {
    // agentsys resolver not available; fall through to vendored binary
  }
  try {
    return require('../binary');
  } catch {
    return null;
  }
}

function runJson(binary, args) {
  try {
    const out = binary.runAnalyzer(args);
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Run all analyzer queries sync-docs consumes and return an indexed
 * bundle. See `DEFAULT_DOC_DRIFT_IGNORE` for the docs filtered from
 * `docDrift`. A raw `docDriftAll` field is included so callers that
 * need the unfiltered list (e.g. explicit `--include-versioned-docs`)
 * can recover it without a second binary call.
 *
 * @param {Object} options
 * @param {string} [options.cwd]
 * @param {RegExp[]} [options.docDriftIgnore] - Override default ignore globs
 * @param {number} [options.docDriftTop=50]
 * @param {number} [options.staleDocsTop=500]
 * @returns {{
 *   available: boolean,
 *   reason: string|null,
 *   mapFile: string,
 *   staleDocs: Array|null,
 *   staleDocsByKey: Map<string, Object>|null,
 *   docDrift: Array|null,
 *   docDriftAll: Array|null,
 *   entryPoints: Array|null,
 *   entryPointSet: Set<string>|null,
 *   slopFixes: Array|null,
 *   orphanExports: Array|null,
 *   passthroughWrappers: Array|null,
 *   alwaysTrueConditions: Array|null
 * }}
 */
function collect(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cwd = opts.cwd;
  const mapFile = resolveMapFile(cwd);

  const empty = {
    available: false,
    reason: null,
    mapFile,
    staleDocs: null,
    staleDocsByKey: null,
    docDrift: null,
    docDriftAll: null,
    entryPoints: null,
    entryPointSet: null,
    slopFixes: null,
    orphanExports: null,
    passthroughWrappers: null,
    alwaysTrueConditions: null
  };

  const binary = getBinary();
  if (!binary) {
    return { ...empty, reason: 'analyzer-binary-unavailable' };
  }
  if (!fs.existsSync(mapFile)) {
    return { ...empty, reason: 'repo-intel-map-missing' };
  }

  const staleTop = opts.staleDocsTop ?? 500;
  const driftTop = opts.docDriftTop ?? 50;

  const staleDocs = runJson(binary, [
    'repo-intel', 'query', 'stale-docs',
    '--top', String(staleTop),
    '--map-file', mapFile,
    cwd
  ]) || [];

  const docDriftAll = runJson(binary, [
    'repo-intel', 'query', 'doc-drift',
    '--top', String(driftTop),
    '--map-file', mapFile,
    cwd
  ]) || [];

  const entryPoints = runJson(binary, [
    'repo-intel', 'query', 'entry-points',
    '--map-file', mapFile,
    cwd
  ]) || [];

  const slopRaw = runJson(binary, [
    'repo-intel', 'query', 'slop-fixes',
    '--map-file', mapFile,
    cwd
  ]);
  // slop-fixes returns {fixes:[...], by_file:[...]} or a bare array
  const slopFixes = Array.isArray(slopRaw)
    ? slopRaw
    : (slopRaw?.fixes ?? []);

  // Index stale-docs by "doc:line:reference" for O(1) lookup during
  // per-file issue analysis. Also keep a second index by doc path.
  const staleDocsByKey = new Map();
  const staleDocsByDoc = new Map();
  for (const entry of staleDocs) {
    const key = `${entry.doc}:${entry.line}:${entry.reference}`;
    staleDocsByKey.set(key, entry);
    if (!staleDocsByDoc.has(entry.doc)) {
      staleDocsByDoc.set(entry.doc, []);
    }
    staleDocsByDoc.get(entry.doc).push(entry);
  }

  // Entry-point set is keyed on normalized path so `isEntryPointFile`
  // and `isEntryPointSymbol` stay fast during undocumented-export
  // filtering.
  const entryPointSet = new Set();
  const entryPointSymbols = new Set();
  for (const ep of entryPoints) {
    if (ep.path) entryPointSet.add(ep.path.replace(/\\/g, '/'));
    if (ep.name) entryPointSymbols.add(`${ep.path}:${ep.name}`);
  }

  // Filter doc-drift using ignore globs. The unfiltered list stays on
  // `docDriftAll` so callers can opt back into it.
  const ignore = opts.docDriftIgnore || DEFAULT_DOC_DRIFT_IGNORE;
  const docDrift = docDriftAll.filter((entry) => {
    const p = (entry.path || '').replace(/\\/g, '/');
    return !ignore.some((re) => re.test(p));
  });

  // Partition slop-fixes by category so consumers don't re-scan.
  const orphanExports = slopFixes.filter((f) => f.category === 'orphan-export');
  const passthroughWrappers = slopFixes.filter((f) => f.category === 'passthrough-wrapper');
  const alwaysTrueConditions = slopFixes.filter((f) => f.category === 'always-true-condition');

  return {
    available: true,
    reason: null,
    mapFile,
    staleDocs,
    staleDocsByKey,
    staleDocsByDoc,
    docDrift,
    docDriftAll,
    entryPoints,
    entryPointSet,
    entryPointSymbols,
    slopFixes,
    orphanExports,
    passthroughWrappers,
    alwaysTrueConditions
  };
}

/**
 * Check whether a given (path, symbol) pair is an entry point. Used by
 * undocumented-export filtering to skip `main()`, CLI commands, and
 * framework-loaded config files that don't need prose docs.
 */
function isEntryPointSymbol(bundle, filePath, symbolName) {
  if (!bundle?.entryPointSymbols) return false;
  const normalized = (filePath || '').replace(/\\/g, '/');
  return bundle.entryPointSymbols.has(`${normalized}:${symbolName}`)
    || bundle.entryPointSet.has(normalized);
}

module.exports = {
  DEFAULT_OPTIONS,
  DEFAULT_DOC_DRIFT_IGNORE,
  collect,
  isEntryPointSymbol,
  resolveMapFile,
  resolveStateDir
};
