'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { collect, parseArgs, symbolFromReason } = require('../scripts/collect.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'collect.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write('package.json', JSON.stringify({ name: 'x', version: '2.0.0' }));
  write('src/api.js', 'function parseThing() {}\nfunction keepThing() {}\nmodule.exports = { parseThing, keepThing };\n');
  write('README.md', '# x\n\nversion: 1.0.0\n\nCall `parseThing()` to parse.\n\n```js\nconst { keepThing } = require(\'./src/api\');\n```\n');
  write('CHANGELOG.md', '# Changelog\n\n- Added `parseThing`\n');
  write('.gitmodules', '');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'feature');
  // Two commits: the removal is not in the last one, so a HEAD~1 comparison would miss it.
  write('src/api.js', 'function keepThing() {}\nmodule.exports = { keepThing };\n');
  git('commit', '-q', '-am', 'feat: drop parseThing');
  write('src/other.js', 'module.exports = {};\n');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: other');
  return dir;
}

test('parseArgs reads scope, base, flag and path', () => {
  assert.deepStrictEqual(parseArgs(['apply', '--scope=before-pr', '--base=dev', '--include-undocumented', 'src']), {
    scope: 'before-pr', base: 'dev', includeUndocumented: true, path: 'src', mode: 'apply'
  });
  assert.strictEqual(parseArgs([]).scope, 'recent');
});

test('symbolFromReason takes the first code-formatted name', () => {
  assert.strictEqual(symbolFromReason('exported function `applyFixes` - file has zero importers'), 'applyFixes');
  assert.strictEqual(symbolFromReason('no name here'), null);
});

test('branch scope finds an export removed before the last commit, skips the changelog', () => {
  const dir = repo();
  try {
    const r = collect({ scope: 'before-pr', base: 'main' }, dir);
    assert.strictEqual(r.discovery.range, 'main...HEAD');
    const removed = r.issues.filter(i => i.type === 'removed-export');
    assert.deepStrictEqual(removed.map(i => [i.doc, i.reference, i.line]), [['README.md', 'parseThing', 5]]);
    assert.ok(r.issues.some(i => i.type === 'outdated-version' && i.current === '1.0.0' && i.expected === '2.0.0'));
    assert.ok(!r.issues.some(i => i.doc === 'CHANGELOG.md'));
    assert.strictEqual(r.analyzer.available, false);
    assert.strictEqual(r.changelog.status, 'needs-update');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dotfile with no basename does not match every code example', () => {
  const dir = repo();
  try {
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
    const r = collect({ scope: 'all' }, dir);
    const examples = r.issues.filter(i => i.type === 'code-example');
    assert.ok(examples.every(i => i.referencedFile === 'src/api.js'), JSON.stringify(examples));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI finishes on a CommonJS repo within a small heap', () => {
  const dir = repo();
  try {
    const out = execFileSync(process.execPath, ['--max-old-space-size=128', SCRIPT, '--scope=before-pr', '--base=main'], {
      cwd: dir, encoding: 'utf8', timeout: 20000
    });
    assert.strictEqual(JSON.parse(out).discovery.changedFilesCount, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 1 outside a git work tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-nogit-'));
  try {
    assert.throws(() => execFileSync(process.execPath, [SCRIPT], { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) } }), e => e.status === 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
