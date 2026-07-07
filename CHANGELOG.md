# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Every gate question is now self-contained, and every gate answer is guaranteed to be
  visible. The `ask` helper gains an optional `context=` that appends a tool-neutral clause
  mandating the context be **displayed in the message body immediately before the question** —
  context never rides inside the question string (it truncates on mobile and is swallowable
  mid-turn text). Applied across the workflow: `fix-ticket`'s scope confirm carries the full
  triage list; `merge-ticket`'s needs-changes / CI-failure / unresolved-thread asks each list
  their items, and the branch-deletion confirm shows the per-branch candidate set (which the
  pre-authorized path still displays before any delete); `execute-ticket`'s commit confirm
  shows the full proposed message. `describe-ticket` displays all three product-behavior parts
  with teeth, and after clarifications always displays the refined stories **and** the
  execution plan and STOPs for ratification — no trivial-clarifications escape — before any
  artifact write, branch checkout, or build; `orchestrate-ticket` folds plan ratification into
  its class-1 bubble, relays the Planner's summary/stories/ACs, and ratifies before writing the
  artifact. `describe` and `review` gain unconditional final-message floors (the stories+plan
  summary, and the verdict line with every blocking finding / uncovered criterion) that survive
  quiet mode. The shared argument guard now repeats the recovered id in the final message and
  asks with the candidate ids displayed when the recovery is ambiguous. No confirm's trigger
  point changed; additive on all three tools; no new config keys.

- `/orchestrate-ticket` no longer resolves the Planner/Implementer model split silently —
  model choice is a cost/quality decision the operator owns. Resolution order: **explicit
  per-run instruction > config > ask**. With both `orchestrate.plannerModel` and
  `orchestrate.implementerModel` set, runs use the configured split without asking; partial
  or absent config triggers a preset question (Split — recommended / All-strongest / Budget /
  Custom, via each tool's ask machinery) and the run does not proceed until answered. A
  per-run instruction wins for that run only, skips the question, and is never written back
  to config. The resolved model is pinned on each sub-agent spawn where the tool supports
  it; kickoff and boundary summaries always name which model ran each phase, and persisting
  the choice is offered only after the run completes — never a mid-run or silent config
  write. No new config keys.

### Fixed

- Clarified the 0.4.0 artifact visibility convention (`output.inlineArtifacts`): the inline
  artifact render must land in the turn's **final message**, after all backend writes and
  tool calls — a real run emitted it mid-turn, before the artifact-write/branch-checkout
  tool calls, and agent harnesses only reliably display a turn's final text, so the user saw
  nothing. Every phase skill (`describe`, `execute`, `review`, `fix`, `merge`) now ends on the
  render, never a bare receipt pointing at earlier, possibly-hidden text; `describe-ticket`
  additionally spells out the write-then-render sequencing corollary. No new config knob —
  correctness-only, tool-agnostic and backend-neutral.

## [0.4.0] - 2026-07-07

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
- `init` now detects Maven (`mvn test`), Gradle (`./gradlew test` / `gradle test`), pytest,
  Go (`go test ./...`), and Cargo (`cargo test`) test commands in addition to npm and Make.
  `init --defaults` prints a visible warning instead of silently baking in `npm test` when
  no stack is detectable.
- README: documents conversational bootstrap (a coding agent can run init/build/doctor for
  you), adds an Orchestrate Mode section (roles, config, the two user gates, the batch
  playbook) and the orchestrate-ticket row to the skill/intent tables, and clarifies that
  usage is npx-only — no npm files are written into consumer repos (Java/Python safe).

## [0.3.0] - 2026-07-06

Hardening from the APU-715 postmortem, plus the orchestrate skill.
(Backfilled section — this release was tagged without a changelog entry.)

### Added

- `ticket-flow upgrade`: version-aware regeneration with a `.ticket-flow.manifest.json`,
  a git-status drift guard for hand-edited generated files, manifest-scoped orphan pruning,
  and commented config-block migration; `doctor` warns when the pack predates the running
  version.
- `/orchestrate-ticket`: multi-ticket, multi-model orchestration (`argMode: all`) with an
  optional `orchestrate.plannerModel`/`implementerModel` config block.
- Delegation contract: sub-agents return data; the orchestrator performs and verifies every
  backend write. Phase-gate checkpoints, write receipts on every mutating backend op, an
  argument guard, and a backend MCP preflight in every skill.

### Fixed

- Comment discovery goes through `list_comments` (Linear `get_issue` returns no comments);
  rendering fixes across tools.

## [0.2.0] - 2026-07-06

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

[Unreleased]: https://github.com/apunuj/ticket-flow/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/apunuj/ticket-flow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/apunuj/ticket-flow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/apunuj/ticket-flow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/apunuj/ticket-flow/releases/tag/v0.1.0
