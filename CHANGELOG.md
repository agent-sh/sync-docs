# Changelog

## [Unreleased]

### Added

- Doc-drift signals from `agent-analyzer` binary: docs with low code-coupling are surfaced as likely stale
- Prompt in `sync-docs` skill to generate `repo-intel` map when not found, enabling doc-drift detection
- Pre-fetch of doc-drift data in `sync-docs` command before spawning the agent, reducing redundant binary calls
- Stale-docs query via `repo-intel` binary for precise symbol-level staleness detection: deleted, renamed, and hotspot references surfaced per document
- `sync-docs` command now queries stale-docs data (Phase 2-4) and passes it to the agent; doc-drift kept as supplementary heuristic signal
- README documents detection categories, auto-fix vs flagged issues, and doc-drift integration

### Fixed

- Inline state dir detection replaced with `getStateDirPath()` from `@agentsys/lib`
- Removed stale AUTO-GENERATED comment and redundant instruction from AGENTS.md and CLAUDE.md

## [1.0.0] - 2026-02-21

Initial release. Extracted from [agentsys](https://github.com/agent-sh/agentsys) monorepo.
