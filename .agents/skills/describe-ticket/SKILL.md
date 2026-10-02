---
name: describe-ticket
description: Describe a Linear ticket — product behavior, clarifying questions,
  execution plan, then record the plan as the work artifact and check out the
  ticket branch from latest master (or a retrospective summary if the ticket is
  already closed). Use when the user wants to understand, orient on, plan, or
  recap a ticket — e.g. "plan PROJ-300", "break this ticket down", "what's the
  plan for this", "write up acceptance criteria".
---

> Usage: `/describe-ticket <ticket-id> (e.g., PROJ-300)`

Describe ticket <ticket-id> and orient on it.

**Argument guard.** The ticket argument is `<ticket-id>`. Before anything else, confirm it is a single well-formed ticket id — `<PREFIX>-<number>` (e.g. `PROJ-312`). If it is empty, multi-word, or otherwise malformed (argument substitution can mangle multi-word invocations), do not use it verbatim: recover the intended id from the invocation text or the recent conversation. When the recovery is unambiguous, state which id you recovered and repeat that id in the final message so the user can catch a wrong guess. When several ids are plausible, or none can be recovered, ask the user: which ticket did you mean? — present the options and wait for their answer before continuing. Display the candidate ticket ids you found in the message body immediately before this question — asking without displaying it is non-compliant; never rely on earlier mid-turn text, and keep the question text itself short. A malformed id must never reach backend calls, branch names, or commit messages.

**Delegation contract** — applies whenever any part of this phase is delegated to a sub-agent or another model: sub-agents return data; every backend write (Linear artifact upsert, comment, state move, PR link) stays with you, the orchestrator, and happens in the main loop as soon as the delegated work returns — before the next phase begins. If a sub-agent must write instead, embed this skill's exact write instructions in its prompt (tool names, the artifact sentinel, the upsert-in-place rule). Either way, verify the writes landed (re-read the ticket) before moving on: a delegated run must leave the same trail on the ticket as a single-agent run.

## Steps

1. Fetch the ticket with the Linear MCP **get_issue** tool (`id: <ticket-id>`, `includeRelations: true`). This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.


2. **Branch on status:**
   - If the ticket is **completed or cancelled** → **Retrospective mode** (skip to step 7).
   - Otherwise → **Prospective mode** (continue).

### Prospective mode

3. **Product behavior.** Three parts, in order — display all three in the message body; omitting or burying them mid-turn is non-compliant:

   **a. Summary** (≤80 words). The "why" — the problem it solves or gap it closes, lifted from the ticket's `## Why` / first paragraph (do not invent). Flag any blockers, predecessors, or hybrid pairs noted in the description.

   **b. User stories.** Break the user-visible behavior into 3–6 short user stories (`US-1`..`US-N`), each one sentence, each an observable behavior the user can confirm or redirect on independently. Lift from the ticket's acceptance criteria and behavior tables; do not invent scope. Format: `- **US-1: <one-line behavior>.** <optional trigger/surface>`.

   **c. Acceptance criteria** (verbatim or near-verbatim), as a checklist. If a criterion maps to a story, note it inline (`US-N`).

4. **Clarifying questions.** Output 2–4 questions targeted at genuinely under-specified decisions (ambiguous scope, choices the ticket leaves open, trade-offs, sequencing). **Do not ask about anything the ticket already answers.** If everything is well-specified, say so and skip to step 5b (the plan). Otherwise ask the clarifying questions above as **plain numbered questions in the message body, not through a question dialog**, and end the turn on them: the message is the step-3 output — the summary, the user stories, and the acceptance criteria, followed by the numbered questions as its last lines. Hosts can hide text that precedes a tool call, so a dialog would leave the user answering questions about content they never saw. Asking through a dialog here is non-compliant.

5. **If you asked clarifying questions, STOP and wait for their answers; if everything was well-specified, proceed directly to the plan (b) below.** Do not include the plan in the same response as clarifying questions.

   On the next turn (or immediately, when nothing was asked):

   **a. Restate the refined user-story list — always, even when the clarifications were trivial or changed nothing** (split/merge/drop/reword; flag anything explicitly de-scoped). Skipping this restatement is non-compliant.

   **b. Execution plan (test-driven by default).** A short ordered task list mapped to the confirmed stories, with file/module pointers (repo-root relative, `src/.../Service.ext:42` style). Each task cites the `US-N` it implements. **Default to TDD: for each story, the first task writes a failing test that encodes its acceptance criterion, and the implementation task that follows makes it pass (red → green → refactor).** Name the specific test file/case in each test task. If a story is genuinely untestable (pure config, docs, a throwaway spike), say so and note why TDD is skipped for it. Tight, not exhaustive.

   **Ratify — STOP.** Display the refined user stories (a) and the execution plan (b) together in this message, then STOP and wait for the user to ratify or redirect the plan — always, even when there were no clarifying questions to ask; there is no trivial-clarifications escape. Offer `/review-plan <ticket-id>` for a deeper pass on current-code grounding, regressions/edge cases, architecture, and verification depth. If requested at this point, review the draft and bring the revised plan back to this ratification step. Do not write the work artifact, check out a branch, or start implementing before the plan is ratified.

   **c. Record the work artifact.** A single **marked comment on the ticket** holds the shared work state (the "work artifact"). It is found by the sentinel `<!-- ticket-flow:state v1 -->` and updated in place — never duplicated. Shape:

```
<!-- ticket-flow:state v1 -->
**Ticket-Flow** · status: planning|building|in-review|merged · branch: <branch> · updated: <YYYY-MM-DD>

### User stories
- [ ] US-1 <observable behavior>  (acceptance: <criterion>)
- [ ] US-2 …

### Acceptance criteria
- [ ] AC-1 …

### Plan  (test-driven: a failing test precedes each implementation task)
- [ ] T1 (US-1): <test path> — failing test for <acceptance criterion>
- [ ] T2 (US-1): <impl path> — implement until T1 passes
- [ ] T3 (US-2): …

### PR
<filled by execute-ticket: PR url + number>

### Fix plan
<filled by plan-fix when needed: revision, state planned|blocked|executing|completed,
PR head/base SHAs, selected F-N findings + source links, deferrals + reasons,
F-T-N test/implementation tasks, verification cases, unresolved decisions;
preserve the original Plan and its completion history>

### Plan review
<filled by review-plan: target Plan/Fix plan + revision, code baseline SHAs/dirty state,
ready for execution|blocked, incorporated changes, verification matrix, limitations;
this assessment never replaces the code-review verdict>

### Review verdict
<filled by review-ticket: ready | needs-changes + the blocking findings / uncovered criteria>
```


   Write it now with `status: planning`: **Update the work artifact.** upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (`issueId: <ticket-id>`) and find the one containing `<!-- ticket-flow:state v1 -->`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (`issueId: <ticket-id>`). Never post a second copy — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently. Set `status`, tick the US-N / T-N checkboxes that are now done, refresh `updated`, and fill the `PR` / `Review verdict` sections as those become available. Preserve unrelated sections, including the original plan/history, `Fix plan`, and `Plan review`; change lifecycle status and code-review verdict only as directed by the current phase. Invalidate a plan assessment when its target plan or relevant code baseline changes unless this phase also refreshes the assessment against those changes. Then render the updated artifact sections (user stories / acceptance criteria / plan, plus the active fix plan and plan assessment when present, with current checkbox state) inline as part of your turn's final message, after all backend writes and tool calls — the user must never need to open the ticket to see current state. Text emitted between tool calls may not be displayed by the host; a render the user cannot see does not count.

   **Checkpoint — do not check out the branch (step d) until the artifact comment exists on the ticket with `status: planning` (receipt in hand).** The work artifact is the phase gate: a phase is not complete until the ticket reflects it, and a write you cannot show a receipt for did not happen.

   **d. Check out the ticket branch.** The confirmed plan marks the start of work.

Put the repo on the ticket branch, cut from the latest base branch (`master`):

- Derive the branch name from the ticket id `<ticket-id>`: lowercase the id and add a 2–4 word slug, following `{prefix-lower}-{number}-{slug}` (e.g. `PROJ-312` → `proj-312-add-login`).
- If a branch for <ticket-id> already exists, check it out instead of creating one — look for a local or remote branch whose name starts with the lowercased ticket id (`git branch --list` and `git branch -r`).
- If the working tree has uncommitted changes that belong to another ticket, stop and ask — never stash silently or carry another ticket's work onto this branch.
- Otherwise: `git fetch origin` then `git checkout -b <branch> origin/master`.
- Report the branch name and its base commit.

   **Sequence: writes first, render last.** Complete both writes above — the artifact upsert (c) and the branch checkout (d) — before rendering anything back to the user; never render-then-write. The artifact render belongs in this turn's final message, after every backend write and tool call, per the final-message rule below.

   Prospective mode only — never create branches or an artifact when describing closed tickets, and never branch before the plan is confirmed (exploratory describes stay branch-free).

### Retrospective mode (closed tickets)

7. In parallel, gather implementation evidence:
   - `git log --grep="<ticket-id>" --oneline -20` from the repo root.
   - Read the ticket's attachments/links (Linear MCP **get_issue** on `<ticket-id>`) and its comments (Linear MCP **list_comments**, `issueId: <ticket-id>`) for the GitHub PR URL that execute-ticket attached; cross-check with `gh pr list --search "<ticket-id>"` if missing.
   - For the most relevant commit(s), `git show --stat <sha>` to see touched files; read 1–2 structurally important files if a key decision needs citing.

8. Output four sections:
   - **What it was about** (≤80 words): the problem and the behavior asked for (lift from the ticket; do not invent).
   - **User stories.** 3–6 `US-N` items lifted from the original acceptance criteria, each marked with a shipped status inline: `✅` shipped as designed · `🟡` partial (note the gap) · `❌` cut (note where) · `📋` N/A for cancelled. If cancelled, every story is `❌` and Outcome carries the why.
   - **Outcome** (≤80 words): what actually shipped at a system level; caveats, follow-ups, or the rationale for dropping.
   - **Implementation** (≤120 words): key files/modules touched, the structural choice that mattered, non-obvious decisions. Cite `file_path:line_number`.

## Output shape

- Tight prose. Bullets and short paragraphs over walls of text.
- File references repo-root relative, never absolute.
- **Stories + plan floor.** The message that delivers the plan always includes the confirmed user stories and the plan's task summary — the ticket URL alone is never the whole answer.
- End with the ticket URL.
- For prospective plans, suggest `/review-plan <ticket-id>` before `/execute-ticket <ticket-id>`; Review Plan can revise the recorded plan as well as an unratified draft.

**End on the render.** In any turn that updated the work artifact, the artifact render must land in the turn's final message, after all backend writes and tool calls — never only in mid-turn text. A short closing pointer (e.g. the next step to run) may follow it within that same message; never end the turn on a bare receipt that points back at earlier, possibly hidden mid-turn text.

## Resume / idempotency

- If a work artifact already exists for <ticket-id>, offer to resume or refresh it — do not clobber confirmed scope.
- If a branch for <ticket-id> already exists, check it out rather than creating a new one.
