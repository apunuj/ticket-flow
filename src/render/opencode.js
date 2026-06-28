// opencode renderer -> .opencode/command/<name>.md
// Frontmatter: description. Positional args ($1 / $ARGUMENTS). opencode has NO built-in
// code-review command, so review-ticket gets the full review checklist inlined here.
import { frontmatter, usageLine } from './_frontmatter.js';

export default {
  id: 'opencode',

  argToken() {
    return '$1';
  },

  ask(question) {
    return `ask the user: ${question} — present the options and wait for their answer before continuing`;
  },

  codeReview() {
    return [
      'opencode has no built-in code-review command, so review the PR diff directly. Fetch it with `gh pr diff <PR#>` and assess:',
      '\n- **Correctness** — logic bugs, off-by-one, error handling, missed edge cases, race conditions.',
      '\n- **Security** — input validation, authorization, injection, secret handling.',
      '\n- **Performance** — redundant work, N+1 queries, allocations on hot paths.',
      '\n- **Quality** — naming, dead code, duplication, and adherence to the project conventions listed below.',
      '\n- **Tests** — are the changes covered, and does the test gate pass.',
      '\n\nGroup findings as **blocking** vs **nice-to-have**, cite `file:line`, and at low/medium depth report only findings you are confident about (widen coverage at high/max).',
    ].join('');
  },

  wrap({ meta, body }) {
    const fm = frontmatter({ description: meta.description });
    return {
      path: `.opencode/command/${meta.name}.md`,
      content: fm + '\n' + usageLine(meta) + body,
    };
  },
};
