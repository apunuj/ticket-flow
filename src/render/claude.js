// Claude Code renderer -> .claude/skills/<name>/SKILL.md
// Frontmatter: name / description / argument-hint. Positional args ($1). Model-invocable via
// description. Delegates review to the built-in code-review skill.
import { frontmatter } from './_frontmatter.js';

export default {
  id: 'claude',
  displayName: 'Claude Code',

  argToken(meta) {
    // argMode: all → the skill takes the full argument string (e.g. several ticket ids)
    return meta && meta.argMode === 'all' ? '$ARGUMENTS' : '$1';
  },

  ask(question) {
    return `ask the user with **AskUserQuestion** (only when there are 2–4 discrete choices; otherwise plain numbered questions): ${question}`;
  },

  codeReview() {
    return [
      'Invoke the built-in **code-review** skill via the Skill tool — do not re-implement review instructions; that skill carries them.',
      'Pass the PR number, the chosen effort level (low/medium/high/max), and `--comment` — **always** pass `--comment` so findings land as inline PR comments (e.g. `args: "<PR#> high --comment"`); it is not conditional.',
      'For the deepest multi-agent cloud review the user can run `/code-review ultra <PR#>` themselves (it is user-triggered and billed).',
    ].join(' ');
  },

  // pointer used by the overview skill — Claude resolves /name to the skill
  skillRef(name) {
    return `\`/${name}\``;
  },

  // Claude Code project MCP config: .mcp.json, key `mcpServers`, remote server as type:http.
  mcpFile(backend) {
    return {
      path: '.mcp.json',
      key: 'mcpServers',
      name: backend.mcp.name,
      server: { type: 'http', url: backend.mcp.url },
    };
  },

  // Claude auto-invokes the five skills from their description, so it needs no always-on
  // guide. But for DISCOVERY + EDUCATION it gets an overview skill: it shows in the `/`
  // menu as `/ticket-flow` and auto-invokes when someone asks how the workflow works.
  extras({ guide }) {
    const fm = frontmatter({
      name: 'ticket-flow',
      description:
        "Overview of this repo's ticket-driven workflow (next → describe → execute → review → merge) and how to drive it. Use when the user asks how the ticket workflow works, how to get started with tickets, what these skills do, or wants help using ticket-flow.",
    });
    return [
      {
        kind: 'overview',
        path: '.claude/skills/ticket-flow/SKILL.md',
        content: fm + '\n' + guide,
        note: 'overview skill (/ticket-flow)',
      },
    ];
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
