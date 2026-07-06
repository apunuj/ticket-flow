# Ticket-Flow

Ticket-Flow generates portable, ticket-driven development workflows for
[Claude Code](https://claude.com/claude-code), [GitHub Copilot](https://github.com/features/copilot),
and [opencode](https://opencode.ai) from one canonical config file.

Define your project conventions once, choose a ticket backend, and run `ticket-flow build`.
Ticket-Flow renders lifecycle skills in each tool's native format, scaffolds the backend MCP
configuration, and writes a team-facing workflow guide into the repo.

Supported backends: **Linear** and **Jira**.

```
next-ticket -> describe-ticket -> execute-ticket -> review-ticket -> merge-ticket
                                                     ^                  |
                                                     |---- fix-ticket <-|
                                            (loops back on PR feedback / red CI)
```

## What It Generates

Ticket-Flow creates six workflow phases that can be invoked directly or triggered conversationally.

| Phase | Purpose |
|---|---|
| **next-ticket** | Surface the next priority backlog ticket, grouped by milestone or sprint. |
| **describe-ticket** | Turn a ticket into user stories, acceptance criteria, and an execution plan; record the work artifact; create the ticket branch. |
| **execute-ticket** | Implement the plan with an incremental test-and-commit loop, then push, open a PR, attach it to the ticket, and move the ticket to review. |
| **review-ticket** | Review the PR at the requested depth and verify the diff satisfies every acceptance criterion. |
| **fix-ticket** | Address open PR feedback, failing CI, review comments, or change requests, then update the PR. |
| **merge-ticket** | Verify the review gate, merge, close the ticket, clean up branches, and surface the next priority. |

## Why Use It

Agent workflows are easiest to trust when every tool follows the same lifecycle and the same
project rules. Ticket-Flow keeps that lifecycle in one source of truth, then renders it into the
formats your coding assistants already understand.

- **One config, many tools.** Generate Claude Code skills, Copilot prompts/instructions, and
  opencode commands from the same source.
- **Ticket-backed state.** Plans, branches, PR links, review decisions, and follow-up work live in
  a shared work artifact on the ticket itself.
- **Backend-aware output.** Linear and Jira differences are handled by backend adapters, so the
  generated skills can use the right ticket operations without hardcoding your project details.
- **Repo-local workflow.** Commit the generated files and `TICKET-FLOW.md` so teammates get the
  same process when they clone the repo.

## Quick Start

### Prerequisites

- **Node.js 18+**
- **git**
- **GitHub CLI (`gh`)**, authenticated with `gh auth login`
- Access to your Linear or Jira workspace

You do not need to configure the ticket-backend MCP server by hand. `ticket-flow build` scaffolds
the MCP config for each generated tool, and `ticket-flow doctor` reports anything still missing.

### Generate a Workflow

Run these commands from the project repository where you want the workflow files generated:

```bash
npx ticket-flow init
npx ticket-flow build
npx ticket-flow doctor
```

`init` detects sensible defaults from the repo, including project name, base branch, ticket prefix,
and test command. Use `init --defaults` to skip prompts, or edit `ticket-flow.config.yaml` before
building.

`build` writes the configured tool files, backend MCP config, and `TICKET-FLOW.md`. Generated files
are created or merged; existing unrelated config is preserved.

## Generated Files

| Tool | Slash Skills / Commands | Always-On Guidance | MCP Config |
|---|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` | `.claude/skills/ticket-flow/SKILL.md` | `.mcp.json` |
| GitHub Copilot | `.github/prompts/<name>.prompt.md` | `.github/instructions/ticket-flow.instructions.md` | `.vscode/mcp.json` |
| opencode | `.opencode/command/<name>.md` | `.opencode/ticket-flow.md` | `opencode.json` |

Ticket-Flow also writes a repo-level `TICKET-FLOW.md` reference for the generated workflow.

On first launch, your assistant may prompt you to approve the scaffolded MCP server and sign in to
the selected ticket backend.

## Usage

You can run a phase explicitly with `/next-ticket`, `/describe-ticket`, `/execute-ticket`,
`/review-ticket`, `/fix-ticket`, or `/merge-ticket`.

You can also ask naturally:

| You say... | Phase |
|---|---|
| "what should I work on next?" | **next-ticket** |
| "plan PROJ-312" / "break this ticket down" | **describe-ticket** |
| "build it and open a PR" / "ship it" | **execute-ticket** |
| "review the PR" / "is it ready?" | **review-ticket** |
| "fix the review feedback" / "CI is failing" | **fix-ticket** |
| "merge it" / "close out the ticket" | **merge-ticket** |

The generated guidance maps natural language to the same lifecycle procedures as the slash
commands.

## Configuration

Project-specific settings live in `ticket-flow.config.yaml`. Generated skills do not hardcode your
project name, ticket prefix, backend states, branch pattern, merge strategy, or review conventions.

Start from [`templates/ticket-flow.config.yaml`](templates/ticket-flow.config.yaml), or see
[`examples/example.config.yaml`](examples/example.config.yaml) for a fuller configuration.

```yaml
project:  { name: My Project, ticketPrefix: PROJ }
backend:  { type: linear, project: "My Project" }   # linear | jira
git:      { baseBranch: main, mergeStrategy: squash }
test:     { command: "npm test" }
tools:    [claude, copilot, opencode]
```

## How It Works

- **Shared work artifact.** Ticket-Flow stores the plan, branch, PR, review verdict, and follow-up
  state in a marked comment on the ticket. Every generated tool can find and update the same
  artifact across sessions and machines.
- **Resilient lifecycle phases.** Each phase has a primary responsibility, but adjacent phases
  include practical fallbacks. For example, `execute-ticket` can create the branch if
  `describe-ticket` was skipped.
- **Backend-neutral workflow text.** Canonical skill templates describe abstract ticket operations;
  backend adapters render the concrete Linear or Jira instructions.
- **Tool-native output.** Claude Code, GitHub Copilot, and opencode each receive files in the
  format they expect, while the source workflow remains shared.

## Roadmap

- GitHub Issues backend support.

## License

MIT - see [LICENSE](LICENSE).
