// GitHub Copilot renderer -> .github/prompts/<name>.prompt.md
// Frontmatter: description / agent. Named inputs only (${input:ticket}) — NO positional $1.
// Delegates review to Copilot's built-in code review. A "> Usage:" line stands in for the
// missing argument-hint field.
import { frontmatter, usageLine } from './_frontmatter.js';

export default {
  id: 'copilot',

  argToken(meta) {
    return '${input:' + (meta.argName || 'ticket') + '}';
  },

  ask(question) {
    return `ask the user: ${question} — present the options and wait for their answer before continuing`;
  },

  codeReview() {
    return [
      "Use Copilot's built-in code review on the PR (the `/review` prompt, or the Copilot code review agent) at the requested depth.",
      'Collect its findings and carry them into the scope check below.',
    ].join(' ');
  },

  wrap({ meta, body }) {
    const fm = frontmatter({
      description: meta.description,
      agent: 'agent',
    });
    return {
      path: `.github/prompts/${meta.name}.prompt.md`,
      content: fm + '\n' + usageLine(meta) + body,
    };
  },
};
