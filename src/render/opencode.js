// opencode renderer -> .opencode/command/<name>.md
// Frontmatter: description. Positional args ($1 / $ARGUMENTS). opencode has NO built-in
// code-review command, so review-ticket gets the full review checklist inlined here.
import { frontmatter, usageLine } from './_frontmatter.js';
import { inlineReviewChecklist } from './_review-checklist.js';

export default {
  id: 'opencode',
  displayName: 'opencode',

  argToken(meta) {
    return meta && meta.argMode === 'all' ? '$ARGUMENTS' : '$1';
  },

  ask(question) {
    return `ask the user: ${question} — present the options and wait for their answer before continuing`;
  },

  codeReview() {
    return inlineReviewChecklist('opencode');
  },

  // pointer used by the workflow guide: slash shortcut + the command file with the full steps
  skillRef(name) {
    return `\`/${name}\` (steps in \`.opencode/command/${name}.md\`)`;
  },

  // opencode MCP config: opencode.json, key `mcp`, remote server as type:remote + enabled.
  mcpFile(backend) {
    return {
      path: 'opencode.json',
      key: 'mcp',
      name: backend.mcp.name,
      server: { type: 'remote', url: backend.mcp.url, enabled: true },
    };
  },

  // Commands are slash-only. The guide is written to a dedicated file that is wired into
  // opencode's always-on context via the `instructions` array in opencode.json (handled in
  // build.js with create-or-merge so a user's existing config is never clobbered).
  extras({ guide }) {
    return [
      {
        path: '.opencode/ticket-flow.md',
        content: guide,
        note: 'always-on guide',
      },
    ];
  },

  wrap({ meta, body }) {
    const fm = frontmatter({ description: meta.description });
    return {
      path: `.opencode/command/${meta.name}.md`,
      content: fm + '\n' + usageLine(meta) + body,
    };
  },
};
