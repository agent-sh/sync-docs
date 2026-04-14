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

sync-docs runs a multi-phase analysis pipeline:

**Phase 1 - Project detection.** Identifies the project type (JavaScript, Python, Rust, Go) and locates documentation files (README.md, CHANGELOG.md, docs/*.md).

**Phase 2 - Change discovery.** Gets changed files based on scope (recent commits, full branch, or entire codebase) and finds documentation files that reference those changed files by filename, import path, function name, or class name.

**Phase 3 - Issue analysis.** Reads each related doc and checks for:
- Version mismatches between docs and package.json/Cargo.toml
- References to removed or renamed exports
- Import paths that no longer exist
- Code examples that use outdated APIs

**Phase 4 - CHANGELOG check.** Compares recent conventional commits against CHANGELOG entries. Flags commits with no corresponding entry.

**Phase 5 - Doc-drift detection (optional).** When repo-intel data is available, identifies docs with zero code coupling - files that never co-change with code and are likely stale.

### What Gets Auto-Fixed

- Version number updates (doc says 1.0.0, package.json says 1.1.0)
- Missing CHANGELOG entries for conventional commits

### What Gets Flagged for Review

- Removed exports still referenced in documentation
- Code examples that may use outdated function signatures
- Import path changes across docs
- Undocumented exports (when repo-intel data is available)

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

Applies safe fixes (version updates, CHANGELOG entries) and reports remaining issues for manual review. Changes are committed with the message `docs: sync documentation with code changes`.

### Scope Options

- `recent` (default) - files changed since last commit to main
- `all` - scan all docs against all code
- `before-pr` - files in current branch, optimized for pre-PR workflows
- `<path>` - specific file or directory

### Additional Flags

```bash
/sync-docs --include-undocumented    # Find exports with no doc coverage (uses repo-intel)
```

## Requirements

- Git (required for change detection)
- Node.js
- [agentsys](https://github.com/agent-sh/agentsys) runtime
- ast-grep (optional, enables accurate export detection via repo-intel)

## Related Plugins

- [next-task](https://github.com/agent-sh/next-task) - invokes sync-docs in Phase 11 before PR creation
- [drift-detect](https://github.com/agent-sh/drift-detect) - compares project plans vs implementation
- [repo-intel](https://github.com/agent-sh/repo-intel) - provides export data for undocumented-export detection

## License

MIT
