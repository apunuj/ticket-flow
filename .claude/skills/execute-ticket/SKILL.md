---
name: execute-ticket
description: Execute a Linear ticket end to end — implement the planned work
  with an incremental test-and-commit loop, then ship it by running the test
  gate, pushing, opening a PR to master, attaching it to the ticket, and moving
  the ticket to In Review. Use when a planned ticket is ready to build, or when
  built work is ready to go up for review — e.g. "build PROJ-312", "implement
  this ticket", "start coding it", "ship it", "open a PR".
argument-hint: PROJ-NNN
---

Execute ticket $1: build it, then take it up for review. This skill owns the whole span from a planned ticket to an attached PR in **In Review**. For an existing PR's planned review fixes, use `/execute-fix $1`. Merging and closing are **not** this skill's job — that's `/merge-ticket` after review.

**Argument guard.** The ticket argument is `$1`. Before anything else, confirm it is a single well-formed ticket id — `<PREFIX>-<number>` (e.g. `PROJ-312`). If it is empty, multi-word, or otherwise malformed (argument substitution can mangle multi-word invocations), do not use it verbatim: recover the intended id from the invocation text or the recent conversation. When the recovery is unambiguous, state which id you recovered and repeat that id in the final message so the user can catch a wrong guess. When several ids are plausible, or none can be recovered, ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): which ticket did you mean? Display the candidate ticket ids you found in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. A malformed id must never reach backend calls, branch names, or commit messages.

**Delegation contract** — applies whenever any part of this phase is delegated to a sub-agent or another model: sub-agents return data; every backend write (Linear artifact upsert, comment, state move, PR link) stays with you, the orchestrator, and happens in the main loop as soon as the delegated work returns — before the next phase begins. If a sub-agent must write instead, embed this skill's exact write instructions in its prompt (tool names, the artifact sentinel, the upsert-in-place rule). Either way, verify the writes landed (re-read the ticket) before moving on: a delegated run must leave the same trail on the ticket as a single-agent run.

## 1. Setup / resume

Run the opening probe and branch on what you find:

- `git status --short`, `git branch --show-current`, `git log origin/master..HEAD --oneline`.
- Resolve any existing PR: read the ticket's attachments/links (Linear MCP **get_issue** on `$1`) and its comments (Linear MCP **list_comments**, `issueId: $1`) for the GitHub PR URL that execute-ticket attached; cross-check with `gh pr list --search "$1"` if missing. This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.

- **Read the work artifact.** list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->` — that is the work artifact. Use it as the authoritative scope (user stories, acceptance criteria, original plan, active Fix plan and scope selections, Plan review, branch, PR, code-review verdict). **Fallback chain — never hard-fail on a missing artifact:** if the artifact is missing or unparseable, reconstruct scope from the ticket description and from `git log`/`git diff` (the pre-artifact behavior); proceed with that and note you did. This fallback covers a missing **artifact** only — if the Linear MCP itself is missing or erroring, stop per the preflight (a missing work artifact is recoverable; a missing backend is not).


Before implementing the original plan, resolve any blocked `Plan review` assessment or unconfirmed product decision. If relevant code changed after its review, refresh the affected assumptions and verification cases.

Decide the entry point (idempotent — do the least work needed):

- **Clean tree + an open PR already exists** → the ship already happened. Skip to step 5 and just make sure the ticket reflects it (attach, shipping note, state, artifact — each idempotent).
- **Commits ahead of `master` exist and the build looks complete** → skip the build loop; go to step 3 (test gate + ship).
- **Otherwise** → ensure you're on the ticket branch, then build (step 2).

Ensure the branch (primary owner is `/describe-ticket`; this is the fallback). If not already on the ticket branch for $1 (a branch whose name starts with the lowercased ticket id):

Put the repo on the ticket branch, cut from the latest base branch (`master`):

- Derive the branch name from the ticket id `$1`: lowercase the id and add a 2–4 word slug, following `{prefix-lower}-{number}-{slug}` (e.g. `PROJ-312` → `proj-312-add-login`).
- If a branch for $1 already exists, check it out instead of creating one — look for a local or remote branch whose name starts with the lowercased ticket id (`git branch --list` and `git branch -r`).
- If the working tree has uncommitted changes that belong to another ticket, stop and ask — never stash silently or carry another ticket's work onto this branch.
- Otherwise: `git fetch origin` then `git checkout -b <branch> origin/master`.
- Report the branch name and its base commit.

## 2. Implement (the build loop)

**Build-start gate — before the first commit:**

- Ensure the work artifact reflects the build. If no artifact exists — or the plan was supplied externally (a plan file, a chat message, an orchestrator/sub-agent hand-off) and isn't on the ticket yet — create/ingest it now, including the plan and `status: building` (no plan anywhere? derive user stories and acceptance criteria from the ticket description and record those): **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: $1`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count.
- move the ticket to **In Progress** with the Linear MCP **save_issue** tool (`id: $1`, `state: "In Progress"`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently — idempotent: skip if the ticket is already in progress or beyond.
- **Checkpoint — do not write code or commit until both writes above are receipted.** The work artifact is the phase gate: a phase is not complete until the ticket reflects it, and a write you cannot show a receipt for did not happen.


Work the plan from the artifact, task by task:

- Work **test-first (TDD)**, following the plan's test→implementation task pairs: for each `US-N`, write the failing test that encodes its acceptance criterion, watch it fail (red), implement the smallest change to make it pass (green), then refactor. (No plan? Derive the criteria from the ticket and still go test-first.)
- Run the test gate as you go: `npm test`. Keep it green before moving to the next `US-N`.
- **Commit incrementally, scoped to $1.** Each commit references $1 in the title and matches the repo's recent commit style (`git log -3 --format='%H%n%s%n%b'`). End the body with your agent's standard co-author footer.
- After each meaningful step, tick the matching `US-N` / `T-N` checkbox: **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: $1`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count.

## 3. Test gate

Run `npm test` once more as the gate.

**If anything fails, abort the ship.** Report the failing output and stop — do not push or touch the ticket. Shipping resumes only after the user fixes (or explicitly waives) the failures. Never waive the gate silently.

## 4. Commit remainder, push, open the PR

This repo uses a PR flow — feature PRs target **`master`**. Never push directly to it.

- If uncommitted changes remain, scope them to $1 using the artifact's task→file map (fallback: read the diff and confirm which files belong to $1 vs other tickets — default to staging only $1's files). Before committing, when the commit message's phrasing or the file attribution isn't obvious — the Stop-and-ask cases below — ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): commit the staged changes with this message? Display the full proposed commit message — its title and body in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. When both are obvious (the message clearly references $1 and matches the recent commit style, and every staged file plainly belongs to $1), commit without a separate confirm. Use a heredoc so the body formats correctly.
- Push: `git push -u origin <branch>`.
- Open the PR with `gh pr create --base master`, title referencing $1, body containing:
  - **Summary** — what landed, mapped to the ticket's acceptance criteria.
  - **Out of scope** — items deliberately deferred, with the owning ticket.
  - **Test plan** — note that `npm test` passed, plus any manual smoke paths.
  - **Work artifact** — a `## Work artifact` section mirroring the artifact's user-story / acceptance-criteria checklist with current checkbox state.
- Whenever the work artifact changes while the PR is open, refresh the `## Work artifact` section with `gh pr edit --body`.
- If a PR for this branch already exists, push to it instead of creating a new one. Report the PR URL.

## 5. Attach PR + move the ticket to In Review

Attaching the PR is an invariant — `/review-ticket` and `/merge-ticket` resolve the PR from here.

- attach the PR to the ticket with the Linear MCP **save_issue** tool (`id: $1`, `links: [{url: <PR URL>, title: "PR #<n>: <title>"}]`) — skip if the same PR is already attached — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently.
- post a comment on the ticket with the Linear MCP **save_comment** tool (`issueId: $1`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently: a short shipping note — PR link, what landed (mapped to acceptance criteria), what was deferred. Skip if a shipping note already exists for this PR (scan the ticket comments first); a resume posts no duplicate.
- move the ticket to **In Review** with the Linear MCP **save_issue** tool (`id: $1`, `state: "In Review"`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently — idempotent: skip if the ticket is already in In Review or beyond.
- **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: $1`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count. — set `status: in-review` and fill the `PR` section (idempotent in place: the upsert refreshes the same work-artifact comment, never a duplicate); if the artifact changed since the PR body was written, refresh its `## Work artifact` section (`gh pr edit --body`).

**End on the render.** In any turn that updated the work artifact, the artifact render must land in the turn's final message, after all backend writes and tool calls — never only in mid-turn text. A short closing pointer (e.g. the next step to run) may follow it within that same message; never end the turn on a bare receipt that points back at earlier, possibly hidden mid-turn text.

Do **not** move the ticket to its done state — that's `/merge-ticket` after the review gate.

## Stop and ask

- File attribution is ambiguous (a change looks like it spans multiple tickets).
- A commit message has no obvious phrasing — propose one, get confirmation.
- There are commits ahead of `master` that don't reference $1 (they may belong to another ticket).
- The test gate fails (never waive it silently).
