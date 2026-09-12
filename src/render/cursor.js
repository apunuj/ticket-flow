// Cursor renderer -> .cursor/commands/<name>.md
// Command files are plain markdown with NO frontmatter and NO argument substitution, so the
// ticket id is a readable `<ticket-id>` placeholder the argument guard recovers from the
// invocation text, and a "> Usage:" line stands in for the missing argument-hint field.
// Cursor has no built-in code-review command, so review-ticket gets the checklist inlined.
import { frontmatter, usageLine } from './_frontmatter.js';
import { inlineReviewChecklist } from './_review-checklist.js';

export default {
  id: 'cursor',
  displayName: 'Cursor',

  // No $1/$ARGUMENTS substitution in Cursor commands — a literal token would reach the agent
  // unexpanded. A descriptive placeholder reads correctly everywhere it appears (prose,
  // `git log --grep="<ticket-id>"`, `/fix-ticket <ticket-id>`) and trips the argument guard's
  // recovery path, which reads the real id out of the invocation text.
  argToken(meta) {
    if (meta && meta.argMode === 'all') return '<ticket-ids>';
    return meta && meta.argName ? `<${meta.argName}>` : '<ticket-id>';
  },

  ask(question) {
    return `ask the user: ${question} — present the options and wait for their answer before continuing`;
  },

  codeReview() {
    return inlineReviewChecklist('Cursor');
  },

  // pointer used by the workflow guide: slash shortcut + the command file with the full steps
  skillRef(name) {
    return `\`/${name}\` (steps in \`.cursor/commands/${name}.md\`)`;
  },

  // Cursor project MCP config: .cursor/mcp.json, key `mcpServers`, remote server as a bare url.
  mcpFile(backend) {
    return {
      path: '.cursor/mcp.json',
      key: 'mcpServers',
      name: backend.mcp.name,
      server: { url: backend.mcp.url },
    };
  },

  // Commands are slash-only. The guide becomes an always-on project rule (`alwaysApply: true`)
  // so the workflow is conversational too. A dedicated .mdc file under .cursor/rules/ — never
  // clobbers a user's other rules.
  extras({ guide }) {
    const fm = frontmatter({
      description: 'Ticket-driven workflow: recognize the intent and run the matching phase.',
      alwaysApply: true,
    });
    return [
      {
        path: '.cursor/rules/ticket-flow.mdc',
        content: fm + '\n' + guide,
        note: 'always-on guide',
      },
    ];
  },

  wrap({ meta, body }) {
    return {
      path: `.cursor/commands/${meta.name}.md`,
      content: usageLine(meta) + body,
    };
  },
};
