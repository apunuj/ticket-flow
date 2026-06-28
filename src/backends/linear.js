// Linear backend adapter. Realizes the abstract ticket-operation interface as tool-neutral
// natural-language instructions naming the concrete Linear MCP tool. The instructions avoid a
// host-specific prefix (e.g. mcp__claude_ai_Linear__) so the same text works whether the Linear
// MCP is mounted under Claude Code, Copilot, or opencode — the agent resolves "the Linear MCP".

import { ARTIFACT_SENTINEL } from '../artifact.js';

const id = 'linear';

export default {
  id,
  displayName: 'Linear',
  groupingNoun: 'milestone',
  groupingNounPlural: 'milestones',
  capabilities: { groups: true, attachments: true, groupTargetDates: true },
  // surfaced by `ticket-flow check` and in generated docs
  requires:
    'a Linear MCP server connected in your tool (Claude Code, Copilot, or opencode), exposing get_issue / list_issues / list_milestones / save_issue / create_attachment / save_comment.',
  // Official remote MCP server (streamable HTTP). OAuth on first connect. `ticket-flow build`
  // scaffolds this into each tool's MCP config so connecting is a one-time approval.
  mcp: { name: 'linear', url: 'https://mcp.linear.app/mcp' },

  op(name, params, ctx) {
    const t = ctx.ticket; // tool-specific arg token, e.g. $1 or ${input:ticket}
    const states = (ctx.config.backend && ctx.config.backend.states) || {};
    const project =
      (params && params.project) || (ctx.config.backend && ctx.config.backend.project) || '';

    switch (name) {
      case 'getTicket':
        return `fetch the ticket with the Linear MCP **get_issue** tool (\`id: ${t}\`, \`includeRelations: true\`)`;

      case 'listBacklog':
        return `list backlog issues with the Linear MCP **list_issues** tool (\`project: "${project}"\`, \`state: Backlog\`, \`limit: 30\`)`;

      case 'listGroups':
        return `list milestones with the Linear MCP **list_milestones** tool for project \`"${project}"\` (each has a name and optional target date)`;

      case 'setState': {
        const display = states[params.state] || params.state;
        return `move the ticket to **${display}** with the Linear MCP **save_issue** tool (\`id: ${t}\`, \`state: "${display}"\`)`;
      }

      case 'attachPR':
        return `attach the PR to the ticket with the Linear MCP **create_attachment** tool (on \`${t}\`, the PR URL as \`url\` and \`PR #<n>: <title>\` as \`title\`) — skip if the same PR is already attached`;

      case 'getAttachedPR':
        return `read the ticket's attachments/links/comments (Linear MCP **get_issue** on \`${t}\`) for the GitHub PR URL that execute-ticket attached; cross-check with \`gh pr list --search "${t}"\` if missing`;

      case 'addComment':
        return `post a comment on the ticket with the Linear MCP **save_comment** tool (\`issueId: ${t}\`)`;

      case 'getWorkArtifact':
        return `read the ticket comments (Linear MCP **get_issue** on \`${t}\` with \`includeRelations: true\`) and find the one containing \`${ARTIFACT_SENTINEL}\` — that is the work artifact`;

      case 'upsertWorkArtifact':
        return `upsert the work-artifact comment: find the existing comment containing \`${ARTIFACT_SENTINEL}\` and **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (\`issueId: ${t}\`). Never post a second copy`;

      default:
        return `[[unknown op: ${name}]]`;
    }
  },
};
