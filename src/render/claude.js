// Claude Code renderer -> .claude/skills/<name>/SKILL.md
// Frontmatter: name / description / argument-hint. Positional args ($1). Model-invocable via
// description. Delegates review to the built-in code-review skill.
import { frontmatter } from './_frontmatter.js';

export default {
  id: 'claude',

  argToken() {
    return '$1';
  },

  ask(question) {
    return `ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): ${question}`;
  },

  codeReview() {
    return [
      'Invoke the built-in **code-review** skill via the Skill tool — do not re-implement review instructions; that skill carries them.',
      'Pass the PR number, the chosen effort level (low/medium/high/max), and `--comment` if the user opted into inline PR comments (e.g. `args: "<PR#> high --comment"`).',
      'For the deepest multi-agent cloud review the user can run `/code-review ultra <PR#>` themselves (it is user-triggered and billed).',
    ].join(' ');
  },

  wrap({ meta, body }) {
    const fm = frontmatter({
      name: meta.name,
      description: meta.description,
      'argument-hint': meta['argument-hint'],
    });
    return {
      path: `.claude/skills/${meta.name}/SKILL.md`,
      content: fm + '\n' + body,
    };
  },
};
