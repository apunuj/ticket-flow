// GitHub Copilot renderer -> .github/prompts/<name>.prompt.md
// Frontmatter: description / agent. Named inputs only (${input:ticket}) — NO positional $1.
// Delegates review to Copilot's built-in code review. A "> Usage:" line stands in for the
// missing argument-hint field.
import { frontmatter, usageLine } from './_frontmatter.js';

export default {
  id: 'copilot',
  displayName: 'GitHub Copilot',

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

  // pointer used by the workflow guide: slash shortcut + the prompt file with the full steps
  skillRef(name) {
    return `\`/${name}\` (steps in \`.github/prompts/${name}.prompt.md\`)`;
  },

  // VS Code workspace MCP config: .vscode/mcp.json, key `servers`, remote server as type:http.
  mcpFile(backend) {
    return {
      path: '.vscode/mcp.json',
      key: 'servers',
      name: backend.mcp.name,
      server: { type: 'http', url: backend.mcp.url },
    };
  },

  // Prompt files are slash-only. This always-on instructions file (auto-loaded by Copilot
  // Chat/agent on every request, scoped to '**') makes the workflow conversational. A
  // dedicated file under .github/instructions/ — never clobbers a user's copilot-instructions.md.
  extras({ guide }) {
    const fm = frontmatter({
      description: 'Ticket-driven workflow: recognize the intent and run the matching phase.',
      applyTo: '**',
    });
    return [
      {
        path: '.github/instructions/ticket-flow.instructions.md',
        content: fm + '\n' + guide,
        note: 'always-on guide',
      },
    ];
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
