# Working with tickets in this repo (Ticket-Flow)

This repo uses **Ticket-Flow** — a ticket-driven workflow backed by **Linear**, available in **Claude Code**, **Codex**. You drive it by talking to your AI assistant in normal language; slash commands are an optional shortcut.

```text
next-ticket → describe-ticket → review-plan → execute-ticket → review-ticket → merge-ticket
                                                                  │     ↑
                                                                  ↓     │
                                                             plan-fix   │
                                                                  ↓     │
                                                            review-plan │
                                                                  ↓     │
                                                            execute-fix ┘
```

## What each phase does

| Phase | What it does |
|---|---|
| **next-ticket** | Surfaces the next priority backlog tickets (grouped by milestone) and recommends one to pick up. |
| **describe-ticket** | Turns a ticket into user stories + acceptance criteria + a **test-driven** execution plan, records it on the ticket, and cuts the branch. |
| **review-plan** | Deeply reviews and revises either plan against current code, regressions/edge cases, layer boundaries, and verification depth. |
| **execute-ticket** | Builds the initial implementation plan test-first, then ships it: test gate → push → PR → move to **In Review**. |
| **review-ticket** | Reviews the PR at a depth you choose, checks it delivers every acceptance criterion, and logs the full review on the ticket. |
| **plan-fix** | Triages PR findings + failing CI, asks which items to fix, and records an execution plan for review-plan and execute-fix. |
| **execute-fix** | Implements selected fix tasks on the existing PR branch, verifies and pushes them, then hands off for re-review. |
| **merge-ticket** | Gates on the review, merges, closes the ticket, cleans up branches, and surfaces the next priority. |
| **orchestrate-ticket** | Runs the whole lifecycle across one or more tickets with sub-agents (Planner plans + reviews, Implementer builds), bubbling only mid-run product clarifications and review judgment calls to you (plus a model-split choice at kickoff unless pinned in config). |

## How to use it

Just say what you want — the matching phase runs (no slash command needed):

| You say… | Phase |
|---|---|
| "what should I work on next?" | next-ticket |
| "plan PROJ-123" / "break this ticket down" | describe-ticket |
| "review the plan" / "stress-test the fix plan" | review-plan |
| "build it and open a PR" / "ship it" | execute-ticket |
| "execute the fix plan" / "apply the reviewed fixes" | execute-fix |
| "review the PR" / "is it ready?" | review-ticket |
| "fix the review comments" / "fix the failing CI" | plan-fix |
| "merge it" / "close out the ticket" | merge-ticket |
| "work PROJ-101 and PROJ-102 together" | orchestrate-ticket |

Prefer explicit control? Invoke a phase directly: `/next-ticket`, `/describe-ticket`, `/review-plan`, `/execute-ticket`, `/review-ticket`, `/plan-fix`, `/execute-fix`, `/merge-ticket`, `/orchestrate-ticket` — the slash command runs the same procedure.

`plan-fix` replaces `fix-ticket`. It stops after scope selection and planning; use `review-plan` to deepen the plan, then `execute-fix` to apply it on the existing PR. Review Plan also works on Describe Ticket drafts before ratification or on recorded execution plans. It revises the plan and its verification cases without marking the PR ready to merge.

## Where the state lives

All shared state — user stories, the original plan (as checkboxes), the selected fix scope and fix plan, plan assessments, the PR link, and the code-review verdict — lives in a single comment **on the ticket itself** (the "work artifact"). It's updated in place, so the workflow resumes seamlessly across sessions, machines, and even a different one of the supported tools. Nothing important lives in untracked local files.

## One-time setup for contributors

To use these skills you need:

1. **The Linear MCP server** — its config is already scaffolded for the tools this repo uses (e.g. `.mcp.json` for Claude Code), so on first launch you just **approve the server and complete the Linear sign-in** when prompted. (Under the hood: a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment.)
2. **The `gh` CLI authenticated** — run `gh auth login` against this repo's GitHub remote (used by execute / review / merge).

## Using a different AI assistant

This repo currently generates the workflow for **Claude Code**, **Codex**. If you work in a different assistant — or you switch because you hit a usage limit — add it rather than working without the workflow:

```bash
npx ticket-flow add <agent>     # claude | codex | copilot | cursor | opencode
```

That updates `ticket-flow.config.yaml`, generates your assistant's format, and leaves everyone else's files alone — commit the result. `npx ticket-flow doctor` also tells you when an assistant is set up in this repo but has no generated workflow. To cover every assistant at once and stop thinking about it, set `tools: all` in `ticket-flow.config.yaml` and re-run `npx ticket-flow build`.

The workflow's state lives on the ticket, not in your tool, so you can plan in one assistant and execute in another mid-ticket without losing anything.

## First run

Open this repo in your AI assistant and ask: **"what should I work on next?"** — that runs `next-ticket` and recommends where to start.

---

*These skills are generated by [ticket-flow](https://github.com/apunuj/ticket-flow) from `ticket-flow.config.yaml`. Re-run `npx ticket-flow build` after changing the config; don't hand-edit the generated skill files.*

## Feature record helpers

This pack was generated by Ticket-Flow **0.7.0**; feature records use
schema **1**. The stateless foundation exposes `hash`,
`pack-record`, `unpack-record`, and `validate` with typed JSON on stdin.

Use the matching installed package, or after that version is published:

```sh
npx --yes --package ticket-flow@0.7.0 ticket-flow feature <command> --input -
```

These helpers have no tracker access and retain no recovery state. They require no
consumer `package.json`. Exit 0 means valid supplied evidence, 2 means invalid input,
and 1 means an unexpected execution failure. Local validation does not establish
fresh remote reads, user consent, or a successful write. Tracker read-back and
approval remain the caller's responsibility.

CLI input is limited to 16 MiB. Packing returns `UNPACK_INPUT_LIMIT` (exit 2,
no result) if its compact unpack request cannot fit. Preparation is provisional;
finalize with actual part references and the same revision evidence before
publishing a descriptor. On failure, preserve the previous descriptor and pointer.
Send unpack requests as compact UTF-8 JSON without extra whitespace.

Feature conversation skills, domain-specific manifest/publication contracts, and
action gates arrive in later slices; this foundation does not enable those phases.
For an unreleased build, use its local installed executable or tarball rather than
falling back to an older registry version.
