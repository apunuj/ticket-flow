# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Artifact visibility convention: every phase artifact is shown inline in chat after each
  artifact write and mirrored to the PR (a synced `## Work artifact` body section; the review
  verdict is also posted on the PR), not just persisted on the ticket. New config knob
  `output.inlineArtifacts` (default `true`) suppresses the inline echo when set to `false`;
  ticket/PR persistence is unaffected.
- `orchestrate-ticket` now carries the proven multi-PR batch playbook: the orchestrator
  verifies independently (re-runs the test gate on the exact pushed tip, reads each CI
  check's conclusion individually), deferred review findings accumulate in one numbered
  deferred-findings ticket per batch referenced from PR bodies, the Planner spot-verifies
  each applied fix before re-review concludes, a stacked-PR escape hatch (branch off the
  blocker, `rebase --onto` after it merges) covers externally held merges, standing merge
  authority distinguishes dormant (flag-gated, deploys inert) from live changes, and a
  sub-agent brief contract binds delegated work to the ratified plan, scope boundary,
  gates, and a structured return.
- New `createTicket` backend op on both backends (Linear `save_issue`, Jira
  `create-issue`), backing the batch deferred-findings ticket.

### Changed

- `init` no longer prompts for a ticket prefix or backend project. `project.ticketPrefix` and
  `backend.project` are now optional config knobs: the generated skills resolve the active
  project from the backend and read the ticket prefix from ticket ids at runtime. Set either in
  `ticket-flow.config.yaml` to pin it.

## [0.1.0] - 2026-07-06

Initial release.

### Added

- `ticket-flow init` interactive setup wizard that detects sensible defaults
  from the repo (project name, base branch, ticket prefix, test command);
  `--defaults` skips prompts and `--force` overwrites an existing config.
- `ticket-flow build` renders the six lifecycle phases (next, describe, execute,
  review, fix, merge) into each configured tool's native format, scaffolds the
  backend MCP config, and writes a repo-level `TICKET-FLOW.md` guide.
- `ticket-flow check` validates the config and reports backend/tool requirements.
- `ticket-flow doctor` preflight checklist for config, git, `gh`, generated
  files, and MCP setup.
- Backends: Linear and Jira, handled by backend adapters.
- Tool targets: Claude Code skills, GitHub Copilot prompts/instructions, and
  opencode commands, generated from one canonical source.
- Shared work artifact stored as a marked comment on the ticket so every tool
  can find and update the same plan, branch, PR, and review state.

[Unreleased]: https://github.com/apunuj/ticket-flow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/apunuj/ticket-flow/releases/tag/v0.1.0
