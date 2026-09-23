# Changelog

## [Unreleased]

## [1.1.0] - 2026-09-24

### Changed

- Rewrote the command, agent and skill for current models: goal, judgment rules, constraints with reasons and one output contract, instead of JavaScript for the model to act out.
- `/sync-docs apply` applies fixes itself and commits only the files it edited. It no longer needs `next-task:simple-fixer`.
- The "Generate repo-intel?" prompt defaults to skip when AskUserQuestion is missing or the run is unattended. The ast-grep install prompt is gone.
- `recent` scope diffs the branch against its base (`base...HEAD`); on the base branch it covers the last 5 commits. New `--base=BRANCH`.

### Added

- `scripts/collect.js` gathers the evidence as JSON, with tests (`npm test`).

### Fixed

- The skill described analyzer output (`documentsDeadCode`, `documentsWrapper`, stale-docs issues) that no code produced, and its `allowed-tools` had no `node`, so the collectors it named could not run. `collect.js` produces every field.
- Removed exports were only detected between `HEAD~1` and `HEAD`, missing anything removed earlier on the branch.
- CHANGELOG entries naming old symbols were reported as stale docs.
- A changed dotfile (`.gitmodules`, `.gitignore`) has an empty basename and matched every code example in every doc.
- The command parsed SYNC_DOCS_RESULT with a lazy regex (`{[\s\S]*?}`) that stops at the first `}`, so any result with nested objects failed.
- A path scope passed as `--scope=src/api` (the form the prompts document) was ignored: the collector ran the branch diff and labeled it with the path. Found by revuto. Both `--scope=<path>` and a bare path work now.
- The report printed `validation.counts` and `validation.crossPlatform`, which nothing computed. Dropped.


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
