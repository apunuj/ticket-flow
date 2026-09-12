// Codex renderer -> .agents/skills/<name>/SKILL.md
// Frontmatter: name / description only. Codex reads repo-local skills from `.agents/skills/`
// (there is no `.codex/skills/`), and its custom-prompt directory is user-global, so skills are
// the only repo-committable form. No argument substitution, hence a `<ticket-id>` placeholder.
// Codex has a built-in `/review` that diffs against a base branch, so review-ticket delegates.
import { frontmatter, usageLine } from './_frontmatter.js';
import { postInlineComments } from './_review-checklist.js';

export default {
  id: 'codex',
  displayName: 'Codex',

  // Codex skills take no arguments — see cursor.js for the same placeholder reasoning.
  argToken(meta) {
    if (meta && meta.argMode === 'all') return '<ticket-ids>';
    return meta && meta.argName ? `<${meta.argName}>` : '<ticket-id>';
  },

  ask(question) {
    return `ask the user: ${question} — present the options and wait for their answer before continuing`;
  },

  codeReview() {
    return [
      "Use Codex's built-in **`/review`** at the requested depth, comparing the ticket branch against the PR's base branch (`/review` reviews uncommitted changes or a base-branch diff — check out the PR branch first with `gh pr checkout <PR#>`).",
      `Collect its findings and carry them into the scope check below. Then ${postInlineComments()}`,
    ].join(' ');
  },

  // pointer used by the workflow guide: slash shortcut + the skill file with the full steps
  skillRef(name) {
    return `\`/${name}\` (steps in \`.agents/skills/${name}/SKILL.md\`)`;
  },

  // Codex project MCP config: .codex/config.toml, TOML table `[mcp_servers.<name>]`, remote
  // server as a bare url. `format: 'toml'` tells build/doctor to append-merge instead of
  // parsing JSON — AGENTS.md and the rest of the file are left untouched.
  mcpFile(backend) {
    return {
      path: '.codex/config.toml',
      format: 'toml',
      key: 'mcp_servers',
      name: backend.mcp.name,
      server: { url: backend.mcp.url },
    };
  },

  // Codex picks a skill implicitly when the prompt matches its description, so — like Claude
  // Code — it needs no always-on guide. It still gets an overview skill for DISCOVERY +
  // EDUCATION: it shows in the slash list and triggers when someone asks how the workflow works.
  extras({ guide }) {
    const fm = frontmatter({
      name: 'ticket-flow',
      description:
        "Overview of this repo's ticket-driven workflow (next → describe → execute → review → merge) and how to drive it. Use when the user asks how the ticket workflow works, how to get started with tickets, what these skills do, or wants help using ticket-flow.",
    });
    return [
      {
        kind: 'overview',
        path: '.agents/skills/ticket-flow/SKILL.md',
        content: fm + '\n' + guide,
        note: 'overview skill (/ticket-flow)',
      },
    ];
  },

  wrap({ meta, body }) {
    // Codex SKILL.md frontmatter is name + description only — no argument-hint field, so the
    // hint rides as a "> Usage:" line the way it does for copilot/opencode/cursor.
    const fm = frontmatter({
      name: meta.name,
      description: meta.description,
    });
    return {
      path: `.agents/skills/${meta.name}/SKILL.md`,
      content: fm + '\n' + usageLine(meta) + body,
    };
  },
};
