---
name: plan-fix
description: Plan fixes for the open feedback on a Linear ticket's PR — failing
  CI checks, unresolved review comments, change requests, merge conflicts — by
  triaging findings, asking which to fix, and recording a test-driven execution
  plan for review-plan and execute-fix. Planning only; does not apply fixes.
  PR-only. Use when the user wants to act on review comments or fix a
  red/blocked PR — e.g. "fix the review comments on PROJ-312", "address the PR
  feedback", "fix the failing CI", "fix PROJ-312".
---

> Usage: `/plan-fix PROJ-NNN`

Plan fixes for ticket <ticket-id>'s PR feedback. This skill works **only** on top of a PR and ends with a scoped execution plan. Use `/review-plan` to deepen the plan and `/execute-fix` to implement it.

**Argument guard.** The ticket argument is `<ticket-id>`. Before anything else, confirm it is a single well-formed ticket id — `<PREFIX>-<number>` (e.g. `PROJ-312`). If it is empty, multi-word, or otherwise malformed (argument substitution can mangle multi-word invocations), do not use it verbatim: recover the intended id from the invocation text or the recent conversation. When the recovery is unambiguous, state which id you recovered and repeat that id in the final message so the user can catch a wrong guess. When several ids are plausible, or none can be recovered, ask the user: which ticket did you mean? — present the options and wait for their answer before continuing. Display the candidate ticket ids you found in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. A malformed id must never reach backend calls, branch names, or commit messages.

**Delegation contract** — applies whenever any part of this phase is delegated to a sub-agent or another model: sub-agents return data; every backend write (Linear artifact upsert, comment, state move, PR link) stays with you, the orchestrator, and happens in the main loop as soon as the delegated work returns — before the next phase begins. If a sub-agent must write instead, embed this skill's exact write instructions in its prompt (tool names, the artifact sentinel, the upsert-in-place rule). Either way, verify the writes landed (re-read the ticket) before moving on: a delegated run must leave the same trail on the ticket as a single-agent run.

## 1. Resolve the PR

- read the ticket's attachments/links (Linear MCP **get_issue** on `<ticket-id>`) and its comments (Linear MCP **list_comments**, `issueId: <ticket-id>`) for the GitHub PR URL that execute-ticket attached; cross-check with `gh pr list --search "<ticket-id>"` if missing. This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.

- If no PR is found, ask the user for the PR number or URL.
- If none can be supplied — **hard stop**: "No PR found for <ticket-id>. Run `/execute-ticket <ticket-id>` first; plan-fix only works on top of a PR."

## 2. Gather everything that needs fixing — in parallel

- **Failing / pending CI:** `gh pr checks <PR#>` — list each failing or pending check; for failures, pull enough detail to know the cause (`gh run view <run-id> --log-failed`, or the check's output).
- **Review comments & threads:** `gh pr view <PR#> --json reviews,reviewDecision,comments,mergeable` plus the inline threads (`gh api repos/{owner}/{repo}/pulls/<PR#>/comments`). Note any `CHANGES_REQUESTED`. Fetch `reviewThreads` with their `isResolved` state through the GitHub GraphQL API (paginate all connections); REST inline comments alone do not establish which threads are unresolved.
- **Recorded verdict:** **Read the work artifact.** list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: <ticket-id>`) and find the one containing `<!-- ticket-flow:state v1 -->` — that is the work artifact. Use it as the authoritative scope (user stories, acceptance criteria, original plan, active Fix plan and scope selections, Plan review, branch, PR, code-review verdict). **Fallback chain — never hard-fail on a missing artifact:** if the artifact is missing or unparseable, reconstruct scope from the ticket description and from `git log`/`git diff` (the pre-artifact behavior); proceed with that and note you did. This fallback covers a missing **artifact** only — if the Linear MCP itself is missing or erroring, stop per the preflight (a missing work artifact is recoverable; a missing backend is not).
 Read the `Review verdict` (blocking findings / uncovered criteria) and scan the ticket comments for the latest `/review-ticket <ticket-id>` verdict.
- **Merge state:** note `mergeable: CONFLICTING` — a rebase/merge of `master` will be needed.

## 3. Triage — tell me what can be fixed

Present a grouped, deduplicated list; assign a stable finding ID (`F-1`, etc.) and source link to each item, with a one-line **proposed fix**:

- **Failing checks** — job → likely cause → fix.
- **Blocking review findings / change requests** — `file:line` → fix.
- **Unresolved threads** — the ask → fix.
- **Uncovered acceptance criteria** (from the verdict) → fix.
- **Merge conflicts** — the branches involved.

Flag anything **not** auto-fixable — needs a product decision, is out of scope (name the owning ticket), or contradicts the confirmed plan. Those become questions, never silent skips.

## 4. Confirm scope — STOP unless already selected

If scope has already been explicitly selected in this conversation or an orchestrator brief, display and reuse it. Otherwise ask the user: which items to fix now (default: all failing checks + all blocking findings/threads); call out anything to skip or defer — present the options and wait for their answer before continuing. Display the full step-3 triage list — every grouped item with its proposed fix, including the ones flagged not auto-fixable in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. Wait for the answer before making the execution plan. Do not infer selection from silence or from the recommended default.

## 5. Produce the fix execution plan

For the selected scope, inspect the current PR head and relevant implementation, callers, and tests. Record the PR head/base SHAs and cite current repo-root-relative `file:line` evidence. Separate a real product defect from a stale finding, flaky check, or infrastructure failure; pending checks need observation, not an invented code fix.

Create an ordered, **test-driven** plan. For each selected finding, name the reproducing test file/case, concrete input or failure condition, observable expected behavior, implementation task, and verification command. Map tasks to stable finding IDs (`F-1`, etc.) and preserve original story/criterion IDs. Include regression checks for adjacent behavior and relevant layer/interface impacts. State when a problem cannot be reproduced or verified and what evidence is missing; never promise a green test without a meaningful assertion.

Return the full plan together with the selected, skipped, and deferred items (and reasons). Unresolved product choices remain blockers; do not invent decisions. Scope confirmation authorizes planning only: do not modify implementation, run a rebase, commit, push, reply to or resolve PR threads, or open a new PR.

## 6. Record + hand off

- If the artifact is missing, reconstruct it from the ticket and existing PR before recording the fix plan. Preserve the original stories, criteria, plan and completion history; do not replace the original `Plan` with fix tasks.
- Add/update `Fix plan` with a revision identifier, existing PR link/head/base SHAs, confirmed scope and finding IDs/source links, deferrals with reasons, ordered `F-T-N` tasks (new tasks unchecked; preserve completed tasks on resume), verification cases, and unresolved decisions. Set its own state to `planned` (or `blocked` for unresolved decisions). Keep the ticket's lifecycle status `in-review`; do not move it back to planning.
- Retain the actual code-review verdict and its blockers. Invalidate any earlier `Plan review` assessment for a changed fix plan. **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: <ticket-id>`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: <ticket-id>`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count.
- **Checkpoint — do not hand off the fix plan until the confirmed scope and fix plan are receipted in the ticket's work artifact.** The work artifact is the phase gate: a phase is not complete until the ticket reflects it, and a write you cannot show a receipt for did not happen.

- End with the full fix plan and scope decisions plus the PR and ticket URLs. Suggest `/review-plan <ticket-id>` for a deeper pass, then `/execute-fix <ticket-id>` to implement the revised plan on the existing PR branch, followed by `/review-ticket <ticket-id>`.

**End on the render.** In any turn that updated the work artifact, the artifact render must land in the turn's final message, after all backend writes and tool calls — never only in mid-turn text. A short closing pointer (e.g. the next step to run) may follow it within that same message; never end the turn on a bare receipt that points back at earlier, possibly hidden mid-turn text.
## Stop and ask

- A review finding needs a product decision or contradicts confirmed scope.
- A check fails for an environmental/flaky reason with no supported in-repo fix — surface the evidence and options.
- The PR contains commits that do not reference <ticket-id> and their ownership is unclear.

## Resume / idempotency

- Re-read live findings/checks and the existing fix plan. Keep stable IDs and completed tasks; skip already addressed items only with current evidence.
- Honor scope selections already explicitly supplied in this conversation or by the orchestrator; show that scope and do not ask again unless new findings or a changed scope need a decision. With no selection, step 4 must wait for the user's answer; its default is a recommendation, never consent.
- Refresh the same `Fix plan` section. New findings must be triaged and selected before adding them to executable scope.
