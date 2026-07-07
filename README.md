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

Ticket-Flow creates seven workflow skills that can be invoked directly or triggered conversationally:
six lifecycle phases, plus an orchestrate mode that drives several tickets through those phases with
sub-agents.

| Skill | Purpose |
|---|---|
| **next-ticket** | Surface the next priority backlog ticket, grouped by milestone or sprint. |
| **describe-ticket** | Turn a ticket into user stories, acceptance criteria, and an execution plan; record the work artifact; create the ticket branch. |
| **execute-ticket** | Implement the plan with an incremental test-and-commit loop, then push, open a PR, attach it to the ticket, and move the ticket to review. |
| **review-ticket** | Review the PR at the requested depth and verify the diff satisfies every acceptance criterion. |
| **fix-ticket** | Address open PR feedback, failing CI, review comments, or change requests, then update the PR. |
| **merge-ticket** | Verify the review gate, merge, close the ticket, clean up branches, and surface the next priority. |
| **orchestrate-ticket** | Drive one or more tickets through the whole lifecycle with a Planner/Implementer sub-agent split — see [Orchestrate Mode](#orchestrate-mode). |

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

**Non-Node repos:** Node is needed only to *run* the generator. Ticket-Flow writes no
`package.json`, lockfile, or `node_modules` into your repo — use `npx` as shown below rather than
installing it as a dependency. `init` detects the test command for Maven, Gradle, pytest, Go, and
Cargo projects as well as npm and Make, so a Java or Python repo gets a sensible
`ticket-flow.config.yaml` out of the box.

### Generate a Workflow

Run these commands from the project repository where you want the workflow files generated:

```bash
npx ticket-flow init
npx ticket-flow build
npx ticket-flow doctor
```

Or skip the terminal entirely: the bootstrap is itself agent-friendly. Tell your coding agent
(Claude Code, Copilot, opencode) something like

> Set up ticket-flow in this repo: run `npx ticket-flow init --defaults`, adjust
> `ticket-flow.config.yaml` to this project (backend, base branch, test command), then run
> `npx ticket-flow build` and `npx ticket-flow doctor`, fix anything doctor reports, and commit
> the generated files.

and it can drive `init`/`build`/`doctor`, tune the config to the repo, and commit the result —
no manual command-running required.

`init` detects sensible defaults from the repo, including project name, base branch, ticket prefix,
and test command. Use `init --defaults` to skip prompts, or edit `ticket-flow.config.yaml` before
building.

`build` writes the configured tool files, backend MCP config, and `TICKET-FLOW.md`. Generated files
are created or merged; existing unrelated config is preserved.

### Upgrade to a New Version

```bash
npx ticket-flow@latest upgrade
```

`upgrade` regenerates everything at the newest version and, on top of a plain `build`: refuses to
overwrite generated files that carry uncommitted changes (possible hand edits — `--force` to
override), prunes files an earlier version generated that no longer exist, and appends newly
introduced optional config blocks to `ticket-flow.config.yaml` as commented snippets. `doctor`
warns when the generated pack predates the running version.

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
`/review-ticket`, `/fix-ticket`, or `/merge-ticket` — or hand several tickets to
`/orchestrate-ticket` at once.

You can also ask naturally:

| You say... | Phase |
|---|---|
| "what should I work on next?" | **next-ticket** |
| "plan PROJ-312" / "break this ticket down" | **describe-ticket** |
| "build it and open a PR" / "ship it" | **execute-ticket** |
| "review the PR" / "is it ready?" | **review-ticket** |
| "fix the review feedback" / "CI is failing" | **fix-ticket** |
| "merge it" / "close out the ticket" | **merge-ticket** |
| "work PROJ-101 and PROJ-102 together" / "orchestrate these tickets" | **orchestrate-ticket** |

The generated guidance maps natural language to the same lifecycle procedures as the slash
commands.

## Orchestrate Mode

`/orchestrate-ticket PROJ-101 PROJ-102 …` drives one or more tickets through the full lifecycle
with sub-agents doing the heavy phases. Reach for it when a spec splits into two or more
dependency-chained tickets, or when you want a multi-model split — one model planning and
reviewing, another building. For a single small ticket, the plain lifecycle is the better fit.

**Roles.** A **Planner** produces the per-ticket plans and reviews the PRs; an **Implementer**
builds and fixes on the ticket branch; the **orchestrator** keeps everything it must never
delegate — sequencing, every ticket-backend write, git and PR operations, and all user interaction.
Which model runs each role is yours to decide, resolved as **explicit per-run instruction > config >
ask**: a split stated in the invocation wins for that run only, a config with both models set is a
standing answer used without asking, and otherwise the run opens with a preset question — **Split**
(recommended: strongest model plans and reviews, worker model builds and fixes), **All-strongest**,
**Budget**, or **Custom** — and won't proceed until you answer. It offers to save your choice to
config only after the run completes, and the kickoff and boundary summaries always name which model
ran each phase.

```yaml
# Leave unset to be asked per run; set BOTH keys to skip the question.
orchestrate:
  plannerModel: ""       # strongest model — plans and reviews
  implementerModel: ""   # worker model — builds and fixes
```

**Exactly two kinds of questions reach you mid-run.** Product clarifications while planning, and
fix/skip judgment calls on review findings. Everything else — building, verifying, shipping, fixing — runs
autonomously, with hard stops preserved for failing test gates, merges, and destructive actions.

**The batch playbook is built in.** Tickets proceed in dependency order, one phase at a time, each
with its own work artifact, branch, and state trail. The orchestrator verifies independently
(re-runs the test gate on the exact pushed tip and reads each CI check's conclusion, never a
watcher's exit code), collects deferred review findings into one numbered follow-up ticket per
batch, has the Planner spot-verify every applied fix, can stack the next PR on a blocker whose
merge is held externally (rebasing and retargeting once it lands), and — under standing merge
authority — still distinguishes flag-gated dormant changes from anything that alters live behavior,
which always gets an explicit confirm.

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
