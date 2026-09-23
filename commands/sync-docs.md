---
description: Use when user asks to "update docs", "sync documentation", "fix outdated docs", "update changelog", "docs are stale", or after completing code changes that might affect documentation.
codex-description: 'Use when user asks to "update docs", "sync documentation", "fix outdated docs", "refresh README". Compares documentation to actual code and fixes discrepancies.'
argument-hint: "[report|apply] [--scope=recent|all|before-pr] [--base=BRANCH] [--include-undocumented] [path]"
allowed-tools: Task, Skill, Read, Edit, Glob, Grep, Bash(git:*), Bash(node:*), AskUserQuestion
---

# /sync-docs

Find docs that no longer match the code. In `apply` mode, fix them and commit.

Arguments: `$ARGUMENTS`

- `report` (default) or `apply`.
- `--scope=recent` (default: this branch against its base, or the last 5 commits on the base branch), `before-pr`, `all`, or a path.
- `--base=BRANCH`, `--include-undocumented`: passed through.

## Run

Spawn `sync-docs:sync-docs-agent` with `Mode`, `Scope`, and the base or path. If Task is not available, load the `sync-docs` skill (or read this plugin's `skills/sync-docs/SKILL.md`) and run it inline. Either way the result ends with a `=== SYNC_DOCS_RESULT ===` block. Its JSON is nested; if you process it as data, parse it as JSON, not with a regex.

## Apply

In `apply` mode, apply `fixes` yourself with Edit:

- `replace`: replace `search` with `replace` in `file`. If `search` is gone or occurs more than once, skip the fix and list it as not applied.
- `changelog-entry`: add `replace` under the named section of the changelog, creating `## [Unreleased]` if needed.

Then commit only the files you edited: `git add -- <files>` and `git commit -m "docs: sync documentation with code changes"`. Other uncommitted work in the tree is the user's and stays out of the commit. Run git hooks.

In `report` mode, edit nothing.

## Report

```markdown
## Documentation Sync (report|applied)

Range: <discovery.range>, <changedFilesCount> changed files, <relatedDocsCount> related docs

### Issues
- **README.md:42** (high): `parseThing()` was renamed to `parseItem()` in src/api.js

### CHANGELOG
[OK] All changes documented | [WARN] N commits may need entries

### Fixes
- applied: README.md (replace), CHANGELOG.md (changelog-entry)
- not applied: docs/api.md, search text not found
```

Lead with the highest severity. When `analyzer.available` is false, add one line: `[INFO] repo-intel analysis skipped (<reason>); run /repo-intel for stale-symbol and drift checks.` In report mode with fixes available, end with `Run /sync-docs apply to apply N fixes.`

## Errors

- Not a git repository: stop with "Git is required for change detection."
- No changed files in the scope: say so and suggest `--scope=all`.
- The result block is missing or not valid JSON: report the failure with the end of the agent's reply. Do not guess fixes.
