# Changelog

## [Unreleased]

### Added

- Doc-drift signals from `agent-analyzer` binary: docs with low code-coupling are surfaced as likely stale
- Prompt in `sync-docs` skill to generate `repo-intel` map when not found, enabling doc-drift detection
- Pre-fetch of doc-drift data in `sync-docs` command before spawning the agent, reducing redundant binary calls

## [1.0.0] - 2026-02-21

Initial release. Extracted from [agentsys](https://github.com/agent-sh/agentsys) monorepo.
