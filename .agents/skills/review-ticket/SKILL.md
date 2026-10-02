---
name: review-ticket
description: Review the PR attached to a Linear ticket at a user-chosen depth,
  then check the diff delivers every acceptance criterion and project
  convention. PR-only — refuses if no PR exists. Use when the user asks to
  review a ticket or its PR — e.g. "review the PR", "is PROJ-312 ready", "does
  this meet the acceptance criteria".
---

> Usage: `/review-ticket PROJ-NNN`

Review the PR attached to ticket <ticket-id>. This skill works **only** on top of a PR — it never reviews a loose local diff.

**Argument guard.** The ticket argument is `<ticket-id>`. Before anything else, confirm it is a single well-formed ticket id — `<PREFIX>-<number>` (e.g. `PROJ-312`). If it is empty, multi-word, or otherwise malformed (argument substitution can mangle multi-word invocations), do not use it verbatim: recover the intended id from the invocation text or the recent conversation. When the recovery is unambiguous, state which id you recovered and repeat that id in the final message so the user can catch a wrong guess. When several ids are plausible, or none can be recovered, ask the user: which ticket did you mean? — present the options and wait for their answer before continuing. Display the candidate ticket ids you found in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. A malformed id must never reach backend calls, branch names, or commit messages.

**Delegation contract** — applies whenever any part of this phase is delegated to a sub-agent or another model: sub-agents return data; every backend write (Linear artifact upsert, comment, state move, PR link) stays with you, the orchestrator, and happens in the main loop as soon as the delegated work returns — before the next phase begins. If a sub-agent must write instead, embed this skill's exact write instructions in its prompt (tool names, the artifact sentinel, the upsert-in-place rule). Either way, verify the writes landed (re-read the ticket) before moving on: a delegated run must leave the same trail on the ticket as a single-agent run.

## 1. Resolve the PR

- read the ticket's attachments/links (Linear MCP **get_issue** on `<ticket-id>`) and its comments (Linear MCP **list_comments**, `issueId: <ticket-id>`) for the GitHub PR URL that execute-ticket attached; cross-check with `gh pr list --search "<ticket-id>"` if missing. This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.

- If no PR is found, ask the user for the PR number or URL.
- If none can be supplied — **hard stop**: "No PR found for <ticket-id>. Run `/execute-ticket <ticket-id>` first; review-ticket only works on top of a PR." Do not fall back to reviewing the working tree.

## 2. Ask for review depth — always

Even if a depth seems obvious, ask the user: review depth — low (shallow, high-confidence only), medium (standard), high (broader, may include uncertain findings), or max (deepest single pass) — present the options and wait for their answer before continuing — unless an orchestrator has already resolved depth (it resolves depth itself and passes it in the brief); then use the depth you were given and do not ask.

Depth is the **only** thing you ask about. Findings are **always** posted as inline PR comments — this is mandatory and not a user choice; never ask whether comments should go to chat only or also to the PR.

## 3. Gather ticket context

- **Read the work artifact.** list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: <ticket-id>`) and find the one containing `<!-- ticket-flow:state v1 -->` — that is the work artifact. Use it as the authoritative scope (user stories, acceptance criteria, original plan, active Fix plan and scope selections, Plan review, branch, PR, code-review verdict). **Fallback chain — never hard-fail on a missing artifact:** if the artifact is missing or unparseable, reconstruct scope from the ticket description and from `git log`/`git diff` (the pre-artifact behavior); proceed with that and note you did. This fallback covers a missing **artifact** only — if the Linear MCP itself is missing or erroring, stop per the preflight (a missing work artifact is recoverable; a missing backend is not).

- Extract the acceptance criteria / user stories (the contracted scope) and any constraints flagged in the description.

## 4. Run the code review

Use Codex's built-in **`/review`** at the requested depth, comparing the ticket branch against the PR's base branch (`/review` reviews uncommitted changes or a base-branch diff — check out the PR branch first with `gh pr checkout <PR#>`). Collect its findings and carry them into the scope check below. Then **always** post each finding as an inline PR review comment anchored to its `file:line` (`gh api repos/{owner}/{repo}/pulls/<PR#>/comments`) — this is mandatory, not a user choice.

## 5. Scope check + verdict

After the review, add the ticket-scope layer the generic review doesn't know about:

- **Scope check:** does the PR diff actually deliver each acceptance criterion / user story from step 3? List any criterion not covered by the diff.
- **Convention check:** anything that violates the project conventions:
  - (none configured — skip).

End with a clear verdict, stated in chat AND recorded:

- `✅ Ready to merge` — no blocking findings, scope delivered; or
- `🟡 Needs changes` — list the blocking findings and uncovered criteria.

Record the **full review on the ticket** (not just in chat): post a comment on the ticket with the Linear MCP **save_comment** tool (`issueId: <ticket-id>`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently with a structured review comment containing — the **verdict**; the **blocking** and **nice-to-have** findings grouped, each with a repo-root-relative `file:line`; any **uncovered acceptance criteria**; any **convention violations**; and the **PR link**. This comment is the durable record — the inline PR comments (always posted, per step 2) are *in addition*, not instead.

The verdict must ALSO be recorded on the PR — post a PR comment with the verdict line (`gh pr comment <pr> --body "..."`, or append it to the PR description). This top-level verdict comment is in addition to the per-finding inline PR comments (always posted, per step 2).

Then **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: <ticket-id>`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: <ticket-id>`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count. — fill the `Review verdict` section with the verdict **and the list of blocking findings / uncovered criteria**, so `/merge-ticket` can confirm they were addressed. `/merge-ticket` reads this verdict to decide whether review is done.

**Checkpoint — do not hand off or end the review until the verdict comment and the artifact's `Review verdict` update are receipted on the ticket.** The work artifact is the phase gate: a phase is not complete until the ticket reflects it, and a write you cannot show a receipt for did not happen.

If the verdict is `🟡 Needs changes`, hand off: the findings are now on the PR, so suggest `/plan-fix <ticket-id>` to select findings (failing CI included) and prepare a fix plan, then `/review-plan <ticket-id>` → `/execute-fix <ticket-id>` → re-review.

## Output shape

- Findings grouped: blocking vs nice-to-have. File references repo-root relative with line numbers.
- **Verdict floor.** The final message states the verdict line and every blocking finding / uncovered acceptance criterion in full, plus the PR and ticket URLs — never a pointer back at earlier output or "see the ticket."
- End with the PR URL and the ticket URL.

**End on the render.** In any turn that updated the work artifact, the artifact render must land in the turn's final message, after all backend writes and tool calls — never only in mid-turn text. A short closing pointer (e.g. the next step to run) may follow it within that same message; never end the turn on a bare receipt that points back at earlier, possibly hidden mid-turn text.
