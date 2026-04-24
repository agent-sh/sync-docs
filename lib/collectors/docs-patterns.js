/**
 * Documentation Patterns Collector
 *
 * Specialized patterns for sync-docs: finding related docs,
 * detecting outdated references, and analyzing doc issues.
 *
 * @module lib/collectors/docs-patterns
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Lazy-load repo-map to avoid circular dependencies
let repoMapModule = null;
let repoMapLoadError = null;

/**
 * Get the repo-map module, loading it lazily
 * @returns {{module: Object|null, error: string|null}}
 */
function getRepoMap() {
  if (!repoMapModule && !repoMapLoadError) {
    try {
      repoMapModule = require('../repo-map');
    } catch (err) {
      // Module not found or failed to load - store error for diagnostics
      repoMapLoadError = err.message || 'Failed to load repo-map module';
      repoMapModule = null;
    }
  }
  return repoMapModule;
}

/**
 * Get the repo-map load error if any
 * @returns {string|null}
 */
function getRepoMapLoadError() {
  return repoMapLoadError;
}

const DEFAULT_OPTIONS = {
  cwd: process.cwd()
};

// Constants for configuration
const MAX_SCAN_DEPTH = 5;
const MAX_DOC_FILES = 200;
const INTERNAL_DIRS = ['internal', 'private', 'utils', 'helpers', '__tests__', 'test', 'tests'];
const ENTRY_NAMES = ['index', 'main', 'app', 'server', 'cli', 'bin'];

// Regex patterns for export detection (extracted for performance)
const EXPORT_PATTERNS = [
  /export\s+(?:function|class|const|let|var)\s+(\w+)/g,
  /export\s+\{([^}]+)\}/g,
  /module\.exports\s*=\s*\{([^}]+)\}/
];

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if an export should be considered internal (skip documentation checks)
 * @param {string} name - Export name
 * @param {string} filePath - File path
 * @returns {boolean} True if export should be considered internal/private
 */
function isInternalExport(name, filePath) {
  // Underscore prefix convention
  if (name.startsWith('_')) return true;
  
  // Internal directory patterns
  const pathLower = filePath.toLowerCase();
  for (const dir of INTERNAL_DIRS) {
    if (pathLower.includes(`/${dir}/`) || pathLower.includes(`\\${dir}\\`)) {
      return true;
    }
  }
  
  // Test files
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return true;
  
  return false;
}

/**
 * Check if a file is likely an entry point (should have docs but not flagged as undocumented)
 * @param {string} filePath - File path
 * @returns {boolean} True if file appears to be an entry point (index.js, main.js, etc.)
 */
function isEntryPoint(filePath) {
  const basename = path.basename(filePath);
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '').toLowerCase();
  return ENTRY_NAMES.includes(nameWithoutExt);
}

/**
 * Ensure repo-map is available, creating it if possible
 * @param {Object} options - Options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @param {Function} [options.askUser] - Async callback to ask user questions.
 *   Signature: async ({question: string, header: string, options: Array<{label, description}>}) => string
 *   Returns the selected option label or null if declined.
 * @returns {Promise<{available: boolean, map: Object|null, fallbackReason: string|null, installInstructions?: string}>}
 */
async function ensureRepoMap(options = {}) {
  const { cwd = process.cwd(), askUser } = options;
  const repoMap = getRepoMap();
  
  // No repo-map module available
  if (!repoMap) {
    return { available: false, map: null, fallbackReason: 'repo-map-module-not-found' };
  }
  
  // 1. Already exists?
  if (repoMap.exists(cwd)) {
    const map = repoMap.load(cwd);
    return { available: true, map, fallbackReason: null };
  }
  
  // 2. Check ast-grep installation
  const installed = await repoMap.checkAstGrepInstalled();
  
  if (!installed.found) {
    // 3. Ask user if they want to install
    if (askUser) {
      const answer = await askUser({
        question: 'ast-grep not found. Install for better doc sync accuracy?',
        header: 'ast-grep Required',
        options: [
          { label: 'Yes, show instructions', description: 'Better accuracy with AST-based symbol detection' },
          { label: 'No, use regex fallback', description: 'Less accurate but works without additional install' }
        ]
      });
      
      if (answer && answer.includes('Yes')) {
        const instructions = repoMap.getInstallInstructions();
        return { 
          available: false, 
          map: null, 
          fallbackReason: 'ast-grep-install-pending',
          installInstructions: instructions
        };
      }
    }
    
    return { available: false, map: null, fallbackReason: 'ast-grep-not-installed' };
  }
  
  // 4. ast-grep available, try to create repo-map
  try {
    const initResult = await repoMap.init(cwd, { force: false });
    
    if (initResult.success) {
      return { available: true, map: initResult.map, fallbackReason: null };
    }
    
    // Handle "already exists" case (race condition)
    if (initResult.error && initResult.error.includes('already exists')) {
      const map = repoMap.load(cwd);
      return { available: true, map, fallbackReason: null };
    }
    
    // 5. Init failed (e.g., no supported languages)
    return { available: false, map: null, fallbackReason: initResult.error || 'init-failed' };
  } catch (err) {
    return { available: false, map: null, fallbackReason: err.message || 'init-error' };
  }
}

/**
 * Synchronous version of ensureRepoMap (no user prompts, no auto-init)
 * @param {Object} options - Options
 * @returns {{available: boolean, map: Object|null, fallbackReason: string|null}}
 */
function ensureRepoMapSync(options = {}) {
  const { cwd = process.cwd() } = options;
  const repoMap = getRepoMap();
  
  if (!repoMap) {
    return { available: false, map: null, fallbackReason: 'repo-map-module-not-found' };
  }
  
  if (repoMap.exists(cwd)) {
    const map = repoMap.load(cwd);
    return { available: true, map, fallbackReason: null };
  }
  
  return { available: false, map: null, fallbackReason: 'repo-map-not-initialized' };
}

/**
 * Get exports from repo-map for a specific file
 * @param {string} filePath - File path relative to repo root
 * @param {Object} map - Loaded repo-map
 * @returns {string[]|null} List of export names or null if not found
 */
function getExportsFromRepoMap(filePath, map) {
  if (!map || !map.files) return null;
  
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Try exact match first
  let fileData = map.files[normalizedPath];
  
  // Try without leading ./
  if (!fileData && normalizedPath.startsWith('./')) {
    fileData = map.files[normalizedPath.slice(2)];
  }
  
  // Try with leading ./
  if (!fileData && !normalizedPath.startsWith('./')) {
    fileData = map.files['./' + normalizedPath];
  }
  
  if (!fileData || !fileData.symbols || !fileData.symbols.exports) {
    return null;
  }
  
  return fileData.symbols.exports.map(e => e.name);
}

/**
 * Find exports that are not documented in any markdown file
 * @param {string[]} changedFiles - List of changed file paths
 * @param {Object} options - Options
 * @param {Object} [options.repoMapStatus] - Pre-fetched repo-map status (avoids redundant calls)
 * @returns {Array<{type: string, severity: string, file: string, name: string, line: number, certainty: string}>}
 */
function findUndocumentedExports(changedFiles, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Use pre-fetched status if provided, otherwise fetch
  const repoMapStatus = opts.repoMapStatus || ensureRepoMapSync(opts);
  
  if (!repoMapStatus.available || !repoMapStatus.map) {
    return []; // Can't detect without repo-map
  }
  
  const map = repoMapStatus.map;
  const allDocs = findMarkdownFiles(opts.cwd);
  
  // Read all doc content for searching
  let allDocContent = '';
  for (const doc of allDocs) {
    try {
      allDocContent += fs.readFileSync(path.join(opts.cwd, doc), 'utf8') + '\n';
    } catch {
      // Skip unreadable docs
    }
  }
  
  const issues = [];
  
  for (const file of changedFiles) {
    // Normalize path
    const normalizedFile = file.replace(/\\/g, '/');
    const fileData = map.files[normalizedFile] || map.files[normalizedFile.replace(/^\.\//, '')];
    
    if (!fileData || !fileData.symbols || !fileData.symbols.exports) {
      continue;
    }
    
    for (const exp of fileData.symbols.exports) {
      // Skip internal exports (underscore prefix, internal/test dirs)
      if (isInternalExport(exp.name, normalizedFile)) continue;

      // Skip file-level entry points (index.js, main, cli, etc.) —
      // their exports are usually re-exports or the bin target, which
      // are expected to not appear individually in prose docs.
      if (isEntryPoint(normalizedFile)) continue;

      // Skip analyzer-detected entry points: `main()` functions,
      // Cargo [[bin]] targets, package.json bin scripts, framework-
      // loaded configs. These are execution surfaces, not library
      // APIs, and documenting each by name isn't the goal.
      if (opts.analyzer?.entryPointSet?.has(normalizedFile)) continue;
      if (opts.analyzer?.entryPointSymbols?.has(`${normalizedFile}:${exp.name}`)) continue;

      // Check if mentioned in any doc. Word boundary to avoid partial
      // matches; escape regex metacharacters to prevent errors on
      // symbol names containing special chars.
      const namePattern = new RegExp(`\\b${escapeRegex(exp.name)}\\b`);
      if (!namePattern.test(allDocContent)) {
        issues.push({
          type: 'undocumented-export',
          severity: 'low',
          file: normalizedFile,
          name: exp.name,
          line: exp.line || 0,
          kind: exp.kind || 'export',
          certainty: 'MEDIUM',
          suggestion: `Export '${exp.name}' in ${normalizedFile} is not mentioned in any documentation`
        });
      }
    }
  }
  
  return issues;
}

/**
 * Find documentation files related to changed source files
 * @param {string[]} changedFiles - List of changed file paths
 * @param {Object} options - Options
 * @returns {Array<Object>} Related docs with reference types
 */
function findRelatedDocs(changedFiles, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const basePath = opts.cwd;
  const results = [];

  // Find all markdown files
  const docFiles = findMarkdownFiles(basePath);

  for (const file of changedFiles) {
    const basename = path.basename(file).replace(/\.[^.]+$/, '');
    const modulePath = file.replace(/\.[^.]+$/, '');
    const dirName = path.dirname(file);

    for (const doc of docFiles) {
      let content;
      try {
        content = fs.readFileSync(path.join(basePath, doc), 'utf8');
      } catch {
        // File unreadable (permissions, deleted after scan, etc.) - skip
        continue;
      }

      const references = [];

      // Check for various reference types
      if (content.includes(basename)) {
        references.push('filename');
      }
      if (content.includes(file)) {
        references.push('full-path');
      }
      if (content.includes(`from '${modulePath}'`) || content.includes(`from "${modulePath}"`)) {
        references.push('import');
      }
      if (content.includes(`require('${modulePath}')`) || content.includes(`require("${modulePath}")`)) {
        references.push('require');
      }
      if (content.includes(`/${basename}`) || content.includes(`/${basename}.`)) {
        references.push('url-path');
      }

      if (references.length > 0) {
        results.push({
          doc,
          referencedFile: file,
          referenceTypes: references
        });
      }
    }
  }

  return results;
}

/**
 * Find all markdown files in the repository
 * @param {string} basePath - Repository root
 * @returns {string[]} List of markdown file paths
 */
function findMarkdownFiles(basePath) {
  const files = [];
  const excludeDirs = ['node_modules', 'dist', 'build', '.git', 'coverage', 'vendor'];

  function scan(dir, depth = 0) {
    if (depth > MAX_SCAN_DEPTH || files.length > MAX_DOC_FILES) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            scan(fullPath, depth + 1);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(relativePath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  scan(basePath);
  return files;
}

/**
 * Analyze a documentation file for issues
 * @param {string} docPath - Path to the doc file
 * @param {string} changedFile - Path of the changed source file
 * @param {Object} options - Options
 * @returns {Array<Object>} List of issues found
 */
function analyzeDocIssues(docPath, changedFile, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const basePath = opts.cwd;
  const issues = [];

  let content;
  try {
    content = fs.readFileSync(path.join(basePath, docPath), 'utf8');
  } catch {
    // Doc file unreadable - no issues to report
    return issues;
  }

  // 1. Analyzer-sourced removed/missing symbol references. The
  // analyzer's stale-docs query already encodes "symbol mentioned in
  // this doc no longer exists" with rename/deletion signals. Lift
  // those findings rather than regressing to regex + git-show.
  //
  // Stale-docs findings are scoped to the doc (not the doc+changedFile
  // pair), so when the SKILL orchestration calls us N times for a doc
  // that references N changed files, we must emit the findings once.
  // We track emission on a per-run `_staleDocsEmitted` set attached to
  // the analyzer bundle so the second..Nth call for the same doc
  // silently skips. Callers constructing their own bundle can omit
  // the flag and accept the (safe) fallback of attaching it here.
  const analyzer = opts.analyzer;
  const normalizedDoc = docPath.replace(/\\/g, '/');
  if (analyzer?.staleDocsByDoc) {
    if (!analyzer._staleDocsEmitted) {
      analyzer._staleDocsEmitted = new Set();
    }
    if (!analyzer._staleDocsEmitted.has(normalizedDoc)) {
      analyzer._staleDocsEmitted.add(normalizedDoc);
      const staleForDoc = analyzer.staleDocsByDoc.get(normalizedDoc) || [];
      for (const entry of staleForDoc) {
        issues.push({
          type: 'removed-export',
          severity: entry.issue === 'symbol-not-found' ? 'high' : 'medium',
          line: entry.line,
          reference: entry.reference,
          issue: entry.issue,
          suggestion: entry.suggestion,
          detectionMethod: 'analyzer-stale-docs'
        });
      }
    }
  }

  // 2. Check code blocks for outdated imports (cheap local check; the
  // analyzer's stale-docs covers symbol names, not import path strings).
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockRegex) || [];

  for (const block of codeBlocks) {
    const importRegex = /import .* from ['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(block)) !== null) {
      const importPath = match[1];
      const changedModulePath = changedFile.replace(/\.[^.]+$/, '');
      if (importPath.includes(path.basename(changedModulePath))) {
        issues.push({
          type: 'code-example',
          severity: 'medium',
          line: findLineNumber(content, match[0]),
          current: match[0],
          suggestion: 'Verify import path is still valid'
        });
      }
    }
  }

  // 3. Check for outdated version numbers
  try {
    const pkgContent = fs.readFileSync(path.join(basePath, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgContent);
    const currentVersion = pkg.version;

    const versionMatches = content.matchAll(/version[:\s]+['"]?(\d+\.\d+\.\d+)/gi);
    for (const match of versionMatches) {
      const docVersion = match[1];
      if (docVersion !== currentVersion && compareVersions(docVersion, currentVersion) < 0) {
        issues.push({
          type: 'outdated-version',
          severity: 'low',
          line: findLineNumber(content, match[0]),
          current: docVersion,
          expected: currentVersion,
          suggestion: `Update version from ${docVersion} to ${currentVersion}`
        });
      }
    }
  } catch {
    // No package.json or parse error
  }

  return issues;
}

/**
 * Find line number of a string in content
 * @param {string} content - Full content
 * @param {string} search - String to find
 * @returns {number} Line number (1-indexed)
 */
function findLineNumber(content, search) {
  const index = content.indexOf(search);
  if (index === -1) return 0;
  return content.substring(0, index).split('\n').length;
}

/**
 * Validate git ref format (e.g., HEAD, HEAD~1, branch names)
 * @param {string} ref - Git ref to validate
 * @returns {boolean} True if valid
 */
function isValidGitRef(ref) {
  if (typeof ref !== 'string' || !ref) return false;
  // Allow: HEAD, HEAD~N, HEAD^N, branch names (alphanumeric, /, -, _, .)
  // Reject: shell metacharacters, spaces, null bytes
  return /^[a-zA-Z0-9_./-]+(?:[~^][0-9]+)?$/.test(ref);
}

/**
 * Get exports from a file at a specific git ref
 * @param {string} filePath - File path
 * @param {string} ref - Git ref (HEAD, HEAD~1, etc.)
 * @param {Object} options - Options
 * @returns {string[]} List of export names
 */
function getExportsFromGit(filePath, ref, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate ref to prevent command injection
  if (!isValidGitRef(ref)) {
    return [];
  }

  try {
    // Use execFileSync with arguments array to prevent command injection
    // git show requires the ref:path as a single argument
    const content = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const exports = [];

    // Use module-level patterns - clone regex to reset lastIndex for global patterns
    for (const pattern of EXPORT_PATTERNS) {
      // Create new regex to avoid lastIndex issues with global patterns
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1].includes(',')) {
          // Multiple exports (e.g., export { a, b, c })
          const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
          exports.push(...names.filter(n => n && /^\w+$/.test(n)));
        } else {
          exports.push(match[1]);
        }
      }
    }

    return [...new Set(exports)];
  } catch {
    // Git command failed (file not in repo, invalid ref, etc.) - return empty
    return [];
  }
}

/**
 * Compare semantic versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

/**
 * Check CHANGELOG for undocumented changes
 * @param {string[]} changedFiles - Changed files
 * @param {Object} options - Options
 * @returns {Object} CHANGELOG status
 */
function checkChangelog(changedFiles, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const basePath = opts.cwd;
  const changelogPath = path.join(basePath, 'CHANGELOG.md');

  if (!fs.existsSync(changelogPath)) {
    return { exists: false };
  }

  let changelog;
  try {
    changelog = fs.readFileSync(changelogPath, 'utf8');
  } catch {
    return { exists: false, error: 'Could not read CHANGELOG.md' };
  }

  const hasUnreleased = changelog.includes('## [Unreleased]');

  // Get recent commits
  let recentCommits = [];
  try {
    // Use execFileSync with arguments array for safer execution
    const output = execFileSync('git', ['log', '--oneline', '-10', 'HEAD'], {
      cwd: basePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    recentCommits = output.trim().split('\n');
  } catch {
    // Git command failed
  }

  const documented = [];
  const undocumented = [];

  for (const commit of recentCommits) {
    if (!commit) continue;
    const msg = commit.substring(8); // Skip hash
    if (changelog.includes(msg) || changelog.includes(commit.substring(0, 7))) {
      documented.push(msg);
    } else if (msg.match(/^(feat|fix|breaking)/i)) {
      undocumented.push(msg);
    }
  }

  return {
    exists: true,
    hasUnreleased,
    documented,
    undocumented,
    suggestion: undocumented.length > 0
      ? `${undocumented.length} commits may need CHANGELOG entries`
      : null
  };
}

/**
 * Read every doc in `allDocs` once, returning a Map<doc, content>.
 * Unreadable docs are silently skipped. Shared by the cross-check
 * detectors so they don't each re-read the tree.
 */
function readAllDocs(allDocs, basePath) {
  const docContents = new Map();
  for (const doc of allDocs) {
    try {
      docContents.set(doc, fs.readFileSync(path.join(basePath, doc), 'utf8'));
    } catch {
      // Skip unreadable docs
    }
  }
  return docContents;
}

/**
 * Extract the wrapper/orphan symbol name from a slop-fix `reason`
 * string. The reason looks like one of:
 *
 *   "Rust `fn get_user(id: u32)` is a single-call passthrough to `fetch_user` with identical args"
 *   "TS/JS `function getUser(id)` is a single-call passthrough to `fetchUser` with identical args"
 *   "Python `def get_user(id)` is a single-call passthrough to `fetch_user` with identical args"
 *   "Go `func GetUser(id int)` is a single-call passthrough to `fetchUser` with identical args"
 *   "Java `getUser(int id)` is a single-call passthrough to `fetchUser` with identical args"
 *
 * We want just the wrapper name (`get_user`, `getUser`, `GetUser`, …),
 * not the language keyword or the parameter list. Orphan-export
 * reasons sometimes carry `name` directly; fall through to that.
 */
function extractSymbolName(fix) {
  if (!fix?.reason) return fix?.name || null;
  // Strip language keyword prefixes then take the identifier up to `(`.
  const m = fix.reason.match(/`(?:fn |function |def |func )?([A-Za-z_][\w.]*)/);
  return m?.[1] || fix.name || null;
}

/**
 * Find docs that mention symbols flagged as orphan-export. A doc that
 * documents a symbol the analyzer has proved is unreachable is a
 * stronger drift signal than plain "stale reference" — the doc is
 * actively misleading readers.
 */
function findDocumentsDeadCode(orphanExports, docContents) {
  if (!Array.isArray(orphanExports) || orphanExports.length === 0) {
    return [];
  }

  const issues = [];
  for (const orphan of orphanExports) {
    const name = extractSymbolName(orphan);
    if (!name) continue;
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
    for (const [doc, content] of docContents) {
      if (pattern.test(content)) {
        issues.push({
          type: 'documents-dead-code',
          severity: 'high',
          doc,
          reference: name,
          file: orphan.action?.path,
          lines: orphan.action?.lines,
          certainty: 'HIGH',
          suggestion: `'${name}' is documented but the analyzer proves it is unused - remove the doc mention or inline the code`
        });
      }
    }
  }
  return issues;
}

/**
 * Find docs that describe a symbol flagged as passthrough-wrapper as if
 * it has distinct behavior. Usually the doc should describe the
 * underlying call, or the wrapper should be inlined — either way the
 * doc is making a claim the code doesn't back up.
 */
function findDocumentsWrapper(passthroughWrappers, docContents) {
  if (!Array.isArray(passthroughWrappers) || passthroughWrappers.length === 0) {
    return [];
  }

  const issues = [];
  for (const wrapper of passthroughWrappers) {
    const wrapperName = extractSymbolName(wrapper);
    if (!wrapperName) continue;
    const pattern = new RegExp(`\\b${escapeRegex(wrapperName)}\\b`);
    for (const [doc, content] of docContents) {
      if (pattern.test(content)) {
        issues.push({
          type: 'documents-wrapper',
          severity: 'medium',
          doc,
          reference: wrapperName,
          file: wrapper.action?.path,
          lines: wrapper.action?.lines,
          certainty: 'MEDIUM',
          suggestion: `'${wrapperName}' is documented but is a single-call passthrough - describe the underlying call or inline the wrapper`
        });
      }
    }
  }
  return issues;
}

/**
 * Collect all documentation-related data
 * @param {Object} options - Collection options
 * @returns {Object} Collected data
 */
function collect(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const changedFiles = opts.changedFiles || [];

  // Check repo-map availability (symbol table for undocumented-export detection)
  const repoMapStatus = ensureRepoMapSync(opts);

  // Cross-check: docs that reference slop-flagged code (optional).
  // Read each doc once and share the Map between detectors so we don't
  // pay two full walks of the markdown tree per collect() call.
  const allDocs = findMarkdownFiles(opts.cwd);
  const analyzer = opts.analyzer;
  const hasSlopSignals = analyzer?.orphanExports?.length || analyzer?.passthroughWrappers?.length;
  const docContents = hasSlopSignals ? readAllDocs(allDocs, opts.cwd) : new Map();
  const documentsDeadCode = analyzer?.orphanExports
    ? findDocumentsDeadCode(analyzer.orphanExports, docContents)
    : [];
  const documentsWrapper = analyzer?.passthroughWrappers
    ? findDocumentsWrapper(analyzer.passthroughWrappers, docContents)
    : [];

  return {
    relatedDocs: findRelatedDocs(changedFiles, opts),
    changelog: checkChangelog(changedFiles, opts),
    markdownFiles: allDocs,
    // New: repo-map integration
    repoMap: {
      available: repoMapStatus.available,
      fallbackReason: repoMapStatus.fallbackReason,
      stats: repoMapStatus.map ? {
        files: Object.keys(repoMapStatus.map.files || {}).length,
        symbols: repoMapStatus.map.stats?.totalSymbols || 0
      } : null
    },
    // New: undocumented exports detection (pass repoMapStatus and
    // analyzer bundle so entry-point filtering sees Cargo [[bin]] /
    // framework config / main() entries from the symbol-level query).
    undocumentedExports: repoMapStatus.available
      ? findUndocumentedExports(changedFiles, { ...opts, repoMapStatus })
      : [],
    // New: slop cross-checks
    documentsDeadCode,
    documentsWrapper
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  findRelatedDocs,
  findMarkdownFiles,
  analyzeDocIssues,
  checkChangelog,
  getExportsFromGit,
  compareVersions,
  findLineNumber,
  collect,
  // Repo-map integration
  ensureRepoMap,
  ensureRepoMapSync,
  getExportsFromRepoMap,
  findUndocumentedExports,
  isInternalExport,
  isEntryPoint,
  // Slop cross-checks
  findDocumentsDeadCode,
  findDocumentsWrapper,
  // Utilities
  escapeRegex,
  // Diagnostic
  getRepoMapLoadError
};
