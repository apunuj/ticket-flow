// The full review checklist, inlined for tools that have no built-in code-review command of
// their own (opencode, Cursor). Tools that DO have one — Claude Code's code-review skill,
// Copilot's reviewer, Codex's /review — delegate to it instead and never use this.
export function inlineReviewChecklist(toolName) {
  return [
    `${toolName} has no built-in code-review command, so review the PR diff directly. Fetch it with \`gh pr diff <PR#>\` and assess:`,
    '\n- **Correctness** — logic bugs, off-by-one, error handling, missed edge cases, race conditions.',
    '\n- **Security** — input validation, authorization, injection, secret handling.',
    '\n- **Performance** — redundant work, N+1 queries, allocations on hot paths.',
    '\n- **Quality** — naming, dead code, duplication, and adherence to the project conventions listed below.',
    '\n- **Tests** — are the changes covered, and does the test gate pass.',
    '\n\nGroup findings as **blocking** vs **nice-to-have**, cite `file:line`, and at low/medium depth report only findings you are confident about (widen coverage at high/max).',
    `\n\nThen ${postInlineComments()}`,
  ].join('');
}

// The mandatory "post every finding as an inline PR comment" tail. Shared by every tool whose
// reviewer does not post comments itself, so the wording of the mandate stays in one place.
export function postInlineComments() {
  return (
    '**always** post each finding as an inline PR review comment anchored to its `file:line` ' +
    '(`gh api repos/{owner}/{repo}/pulls/<PR#>/comments`) — this is mandatory, not a user choice.'
  );
}
