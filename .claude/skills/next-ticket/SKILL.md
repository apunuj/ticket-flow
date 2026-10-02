---
name: next-ticket
description: List the next priority backlog tickets in a Linear project, grouped
  by milestone, and recommend one to pick up. Use when the user asks what to
  work on next, what's in the backlog, or which ticket to pick up — e.g. "what
  should I work on", "what's next", "show the backlog", "pick a ticket".
argument-hint: "[project]"
---

Surface the next priority backlog tickets, grouped by milestone.

Project: $1 — if no argument was given, resolve your active Linear project (the one for this repo — ask if it's ambiguous).

## Steps

1. **In parallel**, fetch:
   - list backlog issues with the Linear MCP **list_issues** tool (`state: Backlog`, `limit: 30`); scope to the active Linear project for this repo (match it by name or the git remote), and if several could apply, ask which one to use.
   - list milestones with the Linear MCP **list_milestones** tool for that same active project (each has a name and optional target date).

   This first Linear call doubles as the backend preflight: if the tool is missing or the call errors, **stop and tell the user** what the workflow needs — a Linear MCP server connected in your tool, exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment. Do not reconstruct ticket state from git alone and continue; a missing work artifact is recoverable; a missing backend is not.

2. **Filter milestones.** Drop any milestone whose status is completed or cancelled, and any open one with zero backlog tickets attached. Sort survivors by target date ascending; those lacking one sort last.

3. **Sort tickets** by priority (Urgent > High > Medium > Low > None), then by last-updated descending.

4. **Group tickets by milestone.** Tickets with none go to a `No milestone` bucket, ordered last. Bucket order: open milestones in target date order, then `No milestone`.

5. **Filter blocked items.** A ticket is blocked if its description or relations mark it `Blocked by` an open ticket. Blocked tickets don't count toward caps and aren't eligible for the recommendation — hold them for a "blocked, not yet actionable" list.

6. **Apply caps.** Up to 3 unblocked tickets per milestone bucket, **and** no more than 8 unblocked tickets total. Trim from later buckets first; if trimming zeroes out a bucket, drop its header too.

7. **Render** one section per surviving bucket. Per ticket: identifier + title; priority label; a one-sentence hook lifted from the description (the Why / first paragraph); any chain annotations (`Predecessor`, `Depends on`) parsed from the description.

8. **Recommend.** End with a single `Recommend:` line (the exact format is in Output shape), choosing the ticket by considering in order: the earliest milestone with in-flight work; the ticket that unblocks the most downstream work; recent context (if the user just shipped something, prefer what it unblocks); else the top-priority unblocked ticket in the earliest milestone.

## Output shape

Under 400 words. Tight bullet lists, milestone headers, no per-ticket sub-headers:

```
## Milestone: <name> (target date: YYYY-MM-DD)

PROJ-XXX [High] Title
  → one-sentence hook
  → depends on PROJ-WWW (done) — ready

## Blocked, not yet actionable

PROJ-BBB [High] Title — blocked by PROJ-AAA (open)
```

Omit any empty section (including `Blocked` when nothing is blocked). End with: `Recommend: PROJ-ZZZ — <one-line reason, citing the milestone>.`
