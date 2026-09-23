# sync-docs

Detect outdated documentation by comparing docs against actual code state - broken references, version mismatches, stale examples, and missing CHANGELOG entries.

## Why

Documentation drifts from code silently. A function gets renamed, an import path changes, a version bumps - but the README and CHANGELOG still reference the old state. sync-docs compares documentation files against the current codebase and finds the gaps. Safe fixes like version updates and CHANGELOG entries are auto-applied. Ambiguous cases - removed exports referenced in docs, code examples needing context - are flagged for manual review.

**Use cases:**

- Pre-PR check - verify docs match code before opening a pull request
- Post-refactor sweep - find all docs affected by renamed or moved files
- CHANGELOG maintenance - detect commits missing from the changelog
- Full audit - scan all docs against all code for drift

## Installation

```bash
agentsys install sync-docs
```

## Quick Start

```bash
# Check for outdated docs (no changes made)
/sync-docs

# Apply safe fixes (version updates, CHANGELOG entries)
/sync-docs apply

# Check docs related to a specific path
/sync-docs report src/

# Scan entire codebase, not just recent changes
/sync-docs --scope=all
```

## How It Works

`scripts/collect.js` gathers the evidence: the diff range for the scope, docs that reference the changed files, exports removed anywhere in the range and still named in a doc, code examples that import a changed module, versions older than the manifest, and CHANGELOG coverage of `feat`/`fix` commits. When a repo-intel map and the `agent-analyzer` binary are present, it adds symbol-level stale references, docs that name dead or passthrough code, and docs that never change with code.

The agent reads each lead against the doc and the code, drops false positives, and turns real mismatches into exact search-and-replace fixes and CHANGELOG entries. CHANGELOG and other history files are never flagged for naming removed symbols.

### What gets fixed

Any mismatch the agent can express as an exact replacement: renamed symbols, stale versions, broken import paths, missing CHANGELOG entries.

### What gets flagged for review

Findings without a safe mechanical fix: a removed export with no replacement, an example that needs rewriting, docs that drifted from the code, undocumented exports.

## Usage

### Report Mode (default)

```bash
/sync-docs
/sync-docs report src/auth/
/sync-docs report --scope=all
```

Outputs a structured report of documentation issues sorted by severity. No files are modified.

### Apply Mode

```bash
/sync-docs apply
/sync-docs apply --scope=before-pr
```

Applies the fixes and reports the rest for manual review. Only the edited files are committed, with the message `docs: sync documentation with code changes`; other uncommitted work is left alone.

### Scope Options

- `recent` (default) - this branch against its base, or the last 5 commits when on the base branch
- `all` - scan all docs against all code
- `before-pr` - this branch against its base (`--base=BRANCH`, default the remote default branch)
- `<path>` - specific file or directory

### Additional Flags

```bash
/sync-docs --include-undocumented    # Find exports with no doc coverage (needs a repo map from /repo-intel)
/sync-docs --base=develop            # Diff against another base branch
```

## Requirements

- Git (required for change detection)
- Node.js
- [agentsys](https://github.com/agent-sh/agentsys) runtime
- [repo-intel](https://github.com/agent-sh/repo-intel) map and `agent-analyzer` (optional, adds symbol-level checks)

## Related Plugins

- [next-task](https://github.com/agent-sh/next-task) - invokes sync-docs in Phase 11 before PR creation
- [drift-detect](https://github.com/agent-sh/drift-detect) - compares project plans vs implementation
- [repo-intel](https://github.com/agent-sh/repo-intel) - provides export data for undocumented-export detection

## License

MIT
