# sync-docs

> Sync documentation with code changes. Find outdated refs, update CHANGELOG, flag stale examples.

## Overview

An agentsys plugin: the `/sync-docs` command, the `sync-docs-agent` agent and the `sync-docs` skill are Markdown prompts. `scripts/collect.js` gathers the evidence the skill judges, and its output is covered by `tests/collect.test.js`. `lib/` is synced from [agent-core](https://github.com/agent-sh/agent-core); change shared code there, since a local edit is overwritten by the next sync PR. The `SYNC_DOCS_RESULT` block is read by `/prepare-delivery` and `/next-task`, so keep its fields stable.

## Conventions

- Output is plain text with the status markers `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]`, and no emojis or ASCII art. People read it in terminals and other plugins parse it.
- In prose, write a spaced single dash (` - `), not ` -- ` or an em dash.
- Put summaries, plans and audit notes in the PR or issue, not in committed files: committed notes go stale.
- Changes reach main through a PR. A feature or fix is done when tests that cover it pass.
- Keep git hooks on. `scripts/setup-hooks.sh` installs a pre-push hook that runs `npm test`.
- When a script or tool fails, report the failure before working around it, so the tool gets fixed.
- When goals conflict, rank them: plugin users' experience, automation that needs no babysitting, token cost, output quality, simplicity.

## Agents

- sync-docs-agent

## Skills

- sync-docs

## Commands

- sync-docs

## Dev commands

```bash
npm test                        # loads lib/, then the node:test suite
npm run validate                # loads lib/ only
agnix --config .agnix.toml .    # agent config lint, also run in CI
```

## References

- Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem
- https://agentskills.io
