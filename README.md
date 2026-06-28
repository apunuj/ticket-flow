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
| **merge-ticket** | Gate on the review, merge, close the ticket, clean up branches, and surface the next priority. |

## Why

These started as five Claude-Code-only skills hardcoded to one project and one backend. Ticket-Flow makes the same workflow **portable** (three tools) and **reusable** (any project, any supported backend) without maintaining three hand-edited copies — one canonical source, rendered.

## Quick start

```bash
npx ticket-flow init      # write a ticket-flow.config.yaml to start from
# edit ticket-flow.config.yaml for your project
npx ticket-flow build     # generate the skills into .claude / .github / .opencode
npx ticket-flow check     # validate config + report what each backend needs
```

`build` writes, for each configured tool:

- Claude Code → `.claude/skills/<name>/SKILL.md`
- GitHub Copilot → `.github/prompts/<name>.prompt.md`
- opencode → `.opencode/command/<name>.md`

Commit those generated files to your repo so the skills travel with it.

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

## Requirements

- **Linear**: a Linear MCP server connected in your tool.
- **Jira**: an Atlassian/Jira MCP server connected in your tool.
- The `gh` CLI authenticated against your GitHub remote (used by execute / review / merge).
- For Claude Code, `review-ticket` delegates to the built-in `code-review` skill; opencode has no built-in, so the review checklist is inlined.

## Roadmap

- GitHub Issues backend (the abstract interface is already in place).
- Interactive `init`.

## License

MIT — see [LICENSE](LICENSE).
