#!/usr/bin/env node
// collect.js - gather the deterministic sync-docs evidence (changed files, related docs, issues, analyzer signals) as JSON
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const lib = path.join(__dirname, '..', 'lib');

const USAGE = `usage: collect.js [--scope=recent|all|before-pr] [--base=BRANCH] [--include-undocumented] [path]
  prints the sync-docs evidence bundle as JSON; exit 1 outside a git work tree`;

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function lines(s) {
  return (s || '').split('\n').filter(Boolean);
}

function parseArgs(argv) {
  const opts = { scope: 'recent', base: null, includeUndocumented: false, path: null };
  for (const a of argv) {
    if (a.startsWith('--scope=')) opts.scope = a.slice(8);
    else if (a.startsWith('--base=')) opts.base = a.slice(7);
    else if (a === '--include-undocumented') opts.includeUndocumented = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === 'report' || a === 'apply') opts.mode = a;
    else if (!a.startsWith('--')) opts.path = a;
  }
  // The prompts document a path as a --scope value too: `--scope=src/api` is a path scope.
  if (!['recent', 'all', 'before-pr'].includes(opts.scope)) {
    opts.path = opts.path || opts.scope;
    opts.scope = 'path';
  }
  return opts;
}

function resolveBase(flag, cwd) {
  if (flag) return flag;
  const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (head) return head.replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], cwd)
      || git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd)) return name;
  }
  return 'main';
}

function baseRefFor(base, cwd) {
  if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], cwd)) return `origin/${base}`;
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], cwd)) return base;
  return null;
}

// Which files the scope covers, and the ref their "before" state is read from.
function scopeFiles(opts, cwd) {
  if (opts.path) {
    return { files: lines(git(['ls-files', '--', opts.path], cwd)), since: null, how: `path ${opts.path}` };
  }
  if (opts.scope === 'all') {
    return { files: lines(git(['ls-files'], cwd)), since: null, how: 'all tracked files' };
  }
  const base = resolveBase(opts.base, cwd);
  const baseRef = baseRefFor(base, cwd);
  if (baseRef) {
    const mergeBase = git(['merge-base', baseRef, 'HEAD'], cwd);
    const files = lines(git(['diff', '--name-only', `${baseRef}...HEAD`], cwd));
    if (files.length || opts.scope === 'before-pr') {
      return { files, since: mergeBase, how: `${baseRef}...HEAD` };
    }
  }
  // recent on the base branch itself: the last few commits.
  const depth = Math.min(5, Number(git(['rev-list', '--count', 'HEAD'], cwd) || 1) - 1);
  if (depth <= 0) return { files: [], since: null, how: 'no history' };
  return { files: lines(git(['diff', '--name-only', `HEAD~${depth}..HEAD`], cwd)), since: `HEAD~${depth}`, how: `HEAD~${depth}..HEAD` };
}

// Exported names in a file at a ref. Every pattern is global: a non-global regex in an
// exec() loop never advances and grows the result until the process runs out of memory.
const EXPORT_PATTERNS = [
  /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /export\s*\{([^}]+)\}/g,
  /module\.exports\s*=\s*\{([^}]+)\}/g,
  /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g,
  /^pub\s+(?:fn|struct|enum|trait|const|type)\s+([A-Za-z_]\w*)/gm,
  /^def\s+([A-Za-z_]\w*)/gm,
  /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm
];

function exportsAt(file, ref, cwd) {
  const content = git(['show', `${ref}:${file}`], cwd);
  if (!content) return [];
  const names = new Set();
  for (const pattern of EXPORT_PATTERNS) {
    for (const m of content.matchAll(pattern)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s*:\s*|\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  return [...names];
}

function manifestVersion(cwd) {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version || null; } catch { /* none */ }
  try {
    const m = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf8'));
    if (m) return m[1];
  } catch { /* none */ }
  return null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Symbol named in an analyzer slop-fix reason, e.g. "exported function `applyFixes` - ...".
function symbolFromReason(reason) {
  const m = /`([A-Za-z_$][\w$]*)`/.exec(reason || '');
  return m ? m[1] : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineOf(content, needle) {
  const i = content.search(needle);
  return i === -1 ? null : content.slice(0, i).split('\n').length;
}

// CHANGELOG entries describe history: a removed symbol there is a record, not a stale doc.
const HISTORY_DOC = /(^|\/)(CHANGELOG|HISTORY|RELEASES?)\.md$/i;

function docsMentioning(fixes, docs, cwd, type, severity, advice) {
  const out = [];
  for (const fix of fixes) {
    const name = symbolFromReason(fix.reason);
    if (!name || name.length < 4) continue;
    // Only code mentions count: `tool` in a sentence is a word, not a reference to an export.
    const re = new RegExp(`\`[^\`\\n]*\\b${escapeRegex(name)}\\b[^\`\\n]*\``);
    for (const doc of docs) {
      const content = docs.content.get(doc);
      if (!content || !re.test(content)) continue;
      out.push({
        type, severity, doc, line: lineOf(content, re), reference: name,
        file: fix.path, lines: fix.lines, certainty: 'MEDIUM', suggestion: advice(name)
      });
    }
  }
  return out;
}

function collect(opts, cwd = process.cwd()) {
  const docsPatterns = require(path.join(lib, 'collectors', 'docs-patterns'));
  const analyzerQueries = require(path.join(lib, 'collectors', 'analyzer-queries'));

  const scope = scopeFiles(opts, cwd);
  const sourceFiles = scope.files.filter(f => !f.endsWith('.md'));
  const docs = docsPatterns.findMarkdownFiles(cwd).filter(d => !d.split(path.sep).includes('agent-knowledge'));
  docs.content = new Map();
  for (const d of docs) {
    try { docs.content.set(d, fs.readFileSync(path.join(cwd, d), 'utf8')); } catch { /* unreadable */ }
  }
  const liveDocs = docs.filter(d => !HISTORY_DOC.test(d));
  liveDocs.content = docs.content;

  const relatedDocs = docsPatterns.findRelatedDocs(sourceFiles, { cwd })
    .filter(r => !HISTORY_DOC.test(r.doc));
  const analyzer = analyzerQueries.collect({ cwd });

  const issues = [];
  const seen = new Set();
  const push = issue => {
    const key = `${issue.type}:${issue.doc}:${issue.line}:${issue.reference || issue.current || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  // Import paths in code examples that point at a changed module.
  for (const { doc, referencedFile } of relatedDocs) {
    const content = docs.content.get(doc) || '';
    const mod = path.basename(referencedFile).replace(/\.[^.]+$/, '');
    if (mod.length < 3) continue;
    for (const block of content.match(/```[\s\S]*?```/g) || []) {
      for (const m of block.matchAll(/(?:import .* from|require\()\s*['"]([^'"]+)['"]/g)) {
        if (path.basename(m[1]).replace(/\.[^.]+$/, '') !== mod) continue;
        push({
          type: 'code-example', severity: 'medium', doc, line: lineOf(content, escapeRegex(m[0])),
          current: m[0], referencedFile, suggestion: 'Check that this import path and usage still match the code'
        });
      }
    }
  }

  // Versions in docs older than the manifest version.
  const version = manifestVersion(cwd);
  if (version) {
    for (const doc of liveDocs) {
      const content = docs.content.get(doc) || '';
      for (const m of content.matchAll(/version[:\s]+['"]?(\d+\.\d+\.\d+)/gi)) {
        if (compareVersions(m[1], version) < 0) {
          push({
            type: 'outdated-version', severity: 'low', doc, line: lineOf(content, escapeRegex(m[0])),
            current: m[1], expected: version, suggestion: `Version ${m[1]} is older than ${version}`
          });
        }
      }
    }
  }

  // Exports removed anywhere in the scope, not only in the last commit.
  if (scope.since) {
    for (const file of sourceFiles) {
      const before = exportsAt(file, scope.since, cwd);
      if (!before.length) continue;
      const after = exportsAt(file, 'HEAD', cwd);
      for (const name of before.filter(e => !after.includes(e) && e.length >= 4)) {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
        for (const doc of liveDocs) {
          const content = docs.content.get(doc);
          if (!content || !re.test(content)) continue;
          push({
            type: 'removed-export', severity: 'high', doc, line: lineOf(content, re), reference: name,
            referencedFile: file, detectionMethod: 'git', certainty: 'HIGH', suggestion: `'${name}' was removed or renamed in ${file}`
          });
        }
      }
    }
  }

  if (analyzer.available) {
    for (const s of analyzer.staleDocs || []) {
      if (HISTORY_DOC.test(s.doc)) continue;
      push({
        // The analyzer flags any code-formatted word it cannot resolve, so these need a read.
        type: 'removed-export', severity: 'medium', certainty: 'LOW',
        doc: s.doc, line: s.line, reference: s.reference, detectionMethod: 'analyzer-stale-docs',
        suggestion: s.suggestion
      });
    }
  }

  let undocumentedExports = [];
  let repoMap = { requested: Boolean(opts.includeUndocumented), available: false, reason: 'not requested' };
  if (opts.includeUndocumented) {
    const status = docsPatterns.ensureRepoMapSync({ cwd });
    repoMap = { requested: true, available: status.available, reason: status.fallbackReason };
    if (status.available) {
      undocumentedExports = docsPatterns.findUndocumentedExports(sourceFiles, { cwd, repoMapStatus: status })
        .filter(e => !analyzerQueries.isEntryPointSymbol(analyzer, e.file, e.name));
    }
  }

  const documentsDeadCode = analyzer.available
    ? docsMentioning(analyzer.orphanExports || [], liveDocs, cwd, 'documents-dead-code', 'high',
      n => `'${n}' is documented but has no importers - remove the mention or wire the symbol up`)
    : [];
  const documentsWrapper = analyzer.available
    ? docsMentioning(analyzer.passthroughWrappers || [], liveDocs, cwd, 'documents-wrapper', 'medium',
      n => `'${n}' is documented but is a single-call passthrough - describe the underlying call`)
    : [];

  const changelog = docsPatterns.checkChangelog(sourceFiles, { cwd });
  changelog.status = !changelog.exists ? 'missing' : (changelog.undocumented || []).length ? 'needs-update' : 'ok';

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const i of [...issues, ...documentsDeadCode, ...documentsWrapper, ...undocumentedExports]) {
    if (bySeverity[i.severity] !== undefined) bySeverity[i.severity]++;
  }

  return {
    scope: opts.path ? opts.path : opts.scope,
    discovery: {
      range: scope.how,
      changedFilesCount: scope.files.length,
      changedFiles: scope.files.slice(0, 200),
      relatedDocsCount: relatedDocs.length,
      relatedDocs
    },
    issues,
    undocumentedExports,
    documentsDeadCode,
    documentsWrapper,
    docDrift: analyzer.available ? (analyzer.docDrift || []) : [],
    repoMap,
    analyzer: {
      available: Boolean(analyzer.available),
      reason: analyzer.reason || null,
      queryErrors: analyzer.queryErrors || [],
      counts: {
        staleDocs: (analyzer.staleDocs || []).length,
        docDriftFiltered: (analyzer.docDrift || []).length,
        orphanExports: (analyzer.orphanExports || []).length,
        passthroughWrappers: (analyzer.passthroughWrappers || []).length
      }
    },
    changelog,
    summary: { issueCount: issues.length + documentsDeadCode.length + documentsWrapper.length + undocumentedExports.length, bySeverity }
  };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (git(['rev-parse', '--is-inside-work-tree'], process.cwd()) !== 'true') {
    process.stderr.write('git work tree required for change detection\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(collect(opts), null, 2)}\n`);
}

module.exports = { collect, parseArgs, scopeFiles, symbolFromReason };
