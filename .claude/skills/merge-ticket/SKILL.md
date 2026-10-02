---
name: merge-ticket
description: Merge the PR attached to a Linear ticket after the review gate
  passes, close the ticket as Done, run post-merge cleanup, and surface the next
  priority. Use when the user asks to merge a ticket/PR or close out reviewed
  work — e.g. "merge it", "land PROJ-312", "close out the ticket".
argument-hint: PROJ-NNN
---

Merge the PR for ticket $1 and close it — **only** after the review gate passes.

**Argument guard.** The ticket argument is `$1`. Before anything else, confirm it is a single well-formed ticket id — `<PREFIX>-<number>` (e.g. `PROJ-312`). If it is empty, multi-word, or otherwise malformed (argument substitution can mangle multi-word invocations), do not use it verbatim: recover the intended id from the invocation text or the recent conversation. When the recovery is unambiguous, state which id you recovered and repeat that id in the final message so the user can catch a wrong guess. When several ids are plausible, or none can be recovered, ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): which ticket did you mean? Display the candidate ticket ids you found in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. A malformed id must never reach backend calls, branch names, or commit messages.

## 1. Resolve the PR

- read the ticket's attachments/links (Linear MCP **get_issue** on `$1`) and its comments (Linear MCP **list_comments**, `issueId: $1`) for the GitHub PR URL that execute-ticket attached; cross-check with `gh pr list --search "$1"` if missing. This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.

- If no open PR is found, ask the user for it. No PR → stop: nothing to merge; suggest `/execute-ticket $1`.

## 2. Review gate

Merging requires that a review happened **and** its findings are addressed.

- **Infer first.** **Read the work artifact.** list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->` — that is the work artifact. Use it as the authoritative scope (user stories, acceptance criteria, original plan, active Fix plan and scope selections, Plan review, branch, PR, code-review verdict). **Fallback chain — never hard-fail on a missing artifact:** if the artifact is missing or unparseable, reconstruct scope from the ticket description and from `git log`/`git diff` (the pre-artifact behavior); proceed with that and note you did. This fallback covers a missing **artifact** only — if the Linear MCP itself is missing or erroring, stop per the preflight (a missing work artifact is recoverable; a missing backend is not).
 Read the `Review verdict`. Also scan the conversation and the ticket comments for a `/review-ticket $1` verdict.
  - An unfinished fix plan or a verdict saying "fixes in progress" / "re-review needed" → **stop**. Complete the selected fix plan through `/execute-fix $1`, then require `/review-ticket $1` on the updated PR. An earlier ready verdict or a ready `Plan review` assessment cannot override this gate.
  - Clear `✅ Ready to merge` with nothing outstanding → state the inference and proceed.
  - `🟡 Needs changes` with no evidence the findings were addressed → ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): these review findings aren't addressed yet — run /plan-fix to plan their fixes, or stop? Display the unaddressed blocking findings from the review verdict, listed out in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. On confirm, hand off to `/plan-fix $1` and do **not** merge; otherwise **stop**.
- **If inconclusive,** ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): has this PR been reviewed, and are all review comments addressed? If no/unsure — **stop**; suggest `/review-ticket $1`, or `/plan-fix $1` if comments are already on the PR.

Never merge on ambiguous evidence — when in doubt, ask.

## 3. PR health check

`gh pr view <PR#> --json state,mergeable,reviewDecision,statusCheckRollup,reviews` plus `gh pr checks <PR#>`:

- Failing or pending required checks → ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): CI isn't green — run /plan-fix to plan fixes for the failures, or stop? Display each failing or pending check by name in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. On confirm, hand off to `/plan-fix $1`; otherwise stop.
- Unresolved review threads or a `CHANGES_REQUESTED` decision → ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): unresolved threads / changes requested — run /plan-fix to plan their fixes, or stop? Display the unresolved review threads and any CHANGES_REQUESTED decision, listed in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. On confirm, hand off to `/plan-fix $1`; otherwise stop.
- `mergeable: CONFLICTING` → surface and stop; `/plan-fix $1` can plan conflict resolution, followed by `/review-plan $1` and `/execute-fix $1`.

## 4. Merge

- `gh pr merge <PR#> --merge` (matches this repo's history). Report the resulting commit hash.

## 5. Close the ticket

- Compose a closing comment in the project's style: **PR** (link + merge commit) · **Commits** (hashes + titles) · **What landed** (mapped to acceptance criteria) · **Out of scope** (deferred, with owning ticket) · optional **Smoke-test paths**.
- post a comment on the ticket with the Linear MCP **save_comment** tool (`issueId: $1`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently with that body.
- move the ticket to **Done** with the Linear MCP **save_issue** tool (`id: $1`, `state: "Done"`) — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently.
- **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: $1`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: $1`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count. — set `status: merged`.

**End on the render.** In any turn that updated the work artifact, the artifact render must land in the turn's final message, after all backend writes and tool calls — never only in mid-turn text. A short closing pointer (e.g. the next step to run) may follow it within that same message; never end the turn on a bare receipt that points back at earlier, possibly hidden mid-turn text.
   **Merge-local scope.** That render ends the write-turn that closed the ticket (step 5's writes). Cleanup (steps 6–7) may run in a later turn, or — when pre-authorized this turn — continue in the same turn; if it does, re-render the artifact at that turn's true end so the final message still reflects the latest state.


**Checkpoint — do not start cleanup until the closing comment, the done state, and the artifact's `status: merged` update are receipted.** The work artifact is the phase gate: a phase is not complete until the ticket reflects it, and a write you cannot show a receipt for did not happen.

## 6. Post-merge cleanup — always confirm

A merge leaves housekeeping. Surface BOTH and confirm before acting (or proceed if pre-authorized this turn) — never silently skip either, and never delete an unmerged branch without explicit per-branch confirmation:

1. **Delete merged + stale branches.** The just-merged head branch (local *and* remote), plus any branch now fully merged into the base. Enumerate the candidates first (`git branch --merged master`, `git ls-remote --heads origin`), then ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): delete these branches? confirm per branch — never force-delete an unmerged one without an explicit yes. Display the per-branch candidate list — each branch's merged/unmerged status and whether it is local, remote, or both in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. Even on the pre-authorized path, display that exact per-branch set in the message before any delete command runs. Use `git branch -d` for merged locals (`-D` only for an abandoned/never-merged one); `git push origin --delete <branch>` for remotes.
2. **Make the local base branch current.** `git checkout master && git merge --ff-only origin/master` so the next ticket's branch cuts from an up-to-date base.

Report what was deleted and the new local `master` HEAD.

## 7. Surface next priority

Run the `/next-ticket` flow for the same project. Show the top 1–2 unblocked backlog tickets and a one-line recommendation.

## Stop and ask

- Review gate inconclusive or failed (step 2). Any failing check, unresolved thread, or conflict (step 3).
- The PR contains commits that don't reference $1 — they may belong to another ticket.

## Resume / idempotency

- If the PR is already merged, skip to step 5 (close) and step 6 (cleanup).
- If the ticket is already in its done state, skip to cleanup and surfacing the next priority.
