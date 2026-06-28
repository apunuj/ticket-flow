# Ticket-Flow

Generate a portable, **ticket-driven development** workflow for [Claude Code](https://claude.com/claude-code), [GitHub Copilot](https://github.com/features/copilot), and [opencode](https://opencode.ai) — from one canonical source.

You write your project's values once in a config file; `ticket-flow` renders five lifecycle skills into each tool's native format, wired to your ticket backend (Linear or Jira).

```
next-ticket → describe-ticket → execute-ticket → review-ticket → merge-ticket
```

| | |
|---|---|
| **next-ticket** | Surface the next priority backlog ticket to pick up (grouped by milestone / sprint). |
| **describe-ticket** | Turn a ticket into user stories + acceptance criteria + an execution plan, record it as the **work artifact**, and cut the ticket branch. |
| **execute-ticket** | Implement the plan with an incremental test-and-commit loop, then ship it: test gate → push → PR → attach to the ticket → move to *In Review*. |
| **review-ticket** | Review the PR at a chosen depth, then check the diff delivers every acceptance criterion. |
| **fix-ticket** | Address a PR's open feedback — failing CI, review comments, change requests — by triaging, confirming scope + a plan, then fixing and updating the PR. Loops back from review or merge. |
| **merge-ticket** | Gate on the review, merge, close the ticket, clean up branches, and surface the next priority. |

## Why

These started as five Claude-Code-only skills hardcoded to one project and one backend. Ticket-Flow makes the same workflow **portable** (three tools) and **reusable** (any project, any supported backend) without maintaining three hand-edited copies — one canonical source, rendered.

## Getting started

### 1. Prerequisites

- **Node 18+** and **git**.
- **The `gh` CLI, authenticated** — run `gh auth login` against your GitHub remote. `execute`, `review`, and `merge` use it for PRs.

You do **not** need to set up the ticket-backend MCP server by hand — `build` scaffolds it (see below). `ticket-flow doctor` reports anything still missing.

### 2. Generate the skills (run in your project repo)

```bash
npx ticket-flow init      # interactive setup wizard (or `init --defaults` to skip prompts)
npx ticket-flow build     # render the skills, guides, MCP config + TICKET-FLOW.md
npx ticket-flow doctor    # preflight: config, git, gh, generated files, MCP
```

`init` detects sensible defaults from your repo (project, base branch, ticket prefix, test command) and asks only what it can't infer. `build` then writes, per configured tool:

| Tool | Slash skills | Always-on / discovery | MCP config (scaffolded) |
|---|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` | `.claude/skills/ticket-flow/SKILL.md` (`/ticket-flow` overview; auto-invokes on "how do I use this") | `.mcp.json` |
| GitHub Copilot | `.github/prompts/<name>.prompt.md` | `.github/instructions/ticket-flow.instructions.md` (`applyTo: '**'`) | `.vscode/mcp.json` |
| opencode | `.opencode/command/<name>.md` | `.opencode/ticket-flow.md` (via `instructions` in `opencode.json`) | `mcp` in `opencode.json` |

Plus a repo-level **`TICKET-FLOW.md`** team reference. Every generated config is created-or-merged — it never clobbers your existing files.

> `review-ticket` uses Claude Code's built-in **code-review**; opencode has no built-in, so the review checklist is inlined there.

The scaffolded MCP config points at the backend's official remote server (Linear / Atlassian), so on first launch your tool just prompts you to **approve the server and sign in** — no manual MCP setup.

### 3. Commit the generated files

Commit them so the skills travel with the repo and teammates get them on clone — including `TICKET-FLOW.md`, which teaches the workflow with zero setup on their part.

### 4. Use it — conversationally or by slash command

You don't have to type a slash command. Say what you want, and the matching phase runs:

| You say… | Phase |
|---|---|
| "what should I work on next?" | **next-ticket** |
| "plan PROJ-312" / "break this ticket down" | **describe-ticket** |
| "build it and open a PR" / "ship it" | **execute-ticket** |
| "review the PR" / "is it ready?" | **review-ticket** |
| "merge it" / "close out the ticket" | **merge-ticket** |

Claude Code auto-invokes the right skill from its `description`; Copilot and opencode read the always-on guide that maps your phrasing to the phase. You can still invoke any phase explicitly with `/next-ticket`, `/describe-ticket`, … — the slash command and the conversational trigger run the same procedure.

## Configuration

Everything project-specific lives in `ticket-flow.config.yaml` — the generated skills carry none of it hardcoded. See [`templates/ticket-flow.config.yaml`](templates/ticket-flow.config.yaml) for the starting point and [`examples/example.config.yaml`](examples/example.config.yaml) for a fuller one.

```yaml
project:  { name: My Project, ticketPrefix: PROJ }
backend:  { type: linear, project: "My Project" }   # linear | jira
git:      { baseBranch: main, mergeStrategy: squash }
test:     { command: "npm test" }
tools:    [claude, copilot, opencode]
```

## Design notes

- **The work artifact.** Shared state (user stories, plan, branch, PR, review verdict) lives in a single marked comment **on the ticket itself** — the one anchor every tool and backend shares. Skills find it by a sentinel and update it in place, so it survives across sessions, machines, and tools.
- **Collectively exhaustive, with fallbacks.** Every phase has a primary owner, but adjacent skills keep resilient overlaps (e.g. `execute-ticket` creates the branch if `describe-ticket` never ran; scope falls back to a diff-guess if no artifact exists). Re-running a skill mid-flight does the right thing.
- **Backend-neutral bodies.** The canonical skills reference abstract ticket operations; each backend adapter resolves them to concrete tool calls (Linear *milestones* / state set vs Jira *sprints* / transitions). Tool names are written so the host resolves "the Linear MCP" regardless of how it's mounted.
- **Conversational, not just slash.** Each tool also gets an always-on guide rendered from the same source — a trigger map from natural-language intent to phase. Claude Code needs none (skills auto-invoke from their `description`); Copilot loads it via `.github/instructions/*.instructions.md` (`applyTo: '**'`), opencode via the `instructions` array in `opencode.json`. So "ship PROJ-312" works without anyone typing `/execute-ticket`.

## Roadmap

- GitHub Issues backend (the abstract interface is already in place).

## License

MIT — see [LICENSE](LICENSE).
