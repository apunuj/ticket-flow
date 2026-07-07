// Linear backend adapter. Realizes the abstract ticket-operation interface as tool-neutral
// natural-language instructions naming the concrete Linear MCP tool. The instructions avoid a
// host-specific prefix (e.g. mcp__claude_ai_Linear__) so the same text works whether the Linear
// MCP is mounted under Claude Code, Copilot, or opencode — the agent resolves "the Linear MCP".

import { ARTIFACT_SENTINEL } from '../artifact.js';
import { RECEIPT } from './_receipt.js';

const id = 'linear';

export default {
  id,
  displayName: 'Linear',
  groupingNoun: 'milestone',
  groupingNounPlural: 'milestones',
  capabilities: { groups: true, attachments: true, groupTargetDates: true },
  // surfaced by `ticket-flow check` and in generated docs
  requires:
    'a Linear MCP server connected in your tool (Claude Code, Copilot, or opencode), exposing get_issue / list_issues / list_comments / list_milestones / save_issue / save_comment.',
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
        return project
          ? `list backlog issues with the Linear MCP **list_issues** tool (\`project: "${project}"\`, \`state: Backlog\`, \`limit: 30\`)`
          : `list backlog issues with the Linear MCP **list_issues** tool (\`state: Backlog\`, \`limit: 30\`); scope to the active Linear project for this repo (match it by name or the git remote), and if several could apply, ask which one to use`;

      case 'listGroups':
        return project
          ? `list milestones with the Linear MCP **list_milestones** tool for project \`"${project}"\` (each has a name and optional target date)`
          : `list milestones with the Linear MCP **list_milestones** tool for that same active project (each has a name and optional target date)`;

      case 'setState': {
        const display = states[params.state] || params.state;
        return `move the ticket to **${display}** with the Linear MCP **save_issue** tool (\`id: ${t}\`, \`state: "${display}"\`)${RECEIPT}`;
      }

      // create_attachment uploads files (base64 content) — a PR URL is a link, set via save_issue.
      case 'attachPR':
        return `attach the PR to the ticket with the Linear MCP **save_issue** tool (\`id: ${t}\`, \`links: [{url: <PR URL>, title: "PR #<n>: <title>"}]\`) — skip if the same PR is already attached${RECEIPT}`;

      case 'getAttachedPR':
        return `read the ticket's attachments/links (Linear MCP **get_issue** on \`${t}\`) and its comments (Linear MCP **list_comments**, \`issueId: ${t}\`) for the GitHub PR URL that execute-ticket attached; cross-check with \`gh pr list --search "${t}"\` if missing`;

      case 'addComment':
        return `post a comment on the ticket with the Linear MCP **save_comment** tool (\`issueId: ${t}\`)${RECEIPT}`;

      // save_issue with no id creates — Linear has no separate create tool.
      case 'createTicket':
        return project
          ? `create a new issue with the Linear MCP **save_issue** tool (omit \`id\` to create; \`title: <title>\`, \`description: <description>\`, \`project: "${project}"\` in that project's team), and note the new issue's id from the response${RECEIPT}`
          : `create a new issue with the Linear MCP **save_issue** tool (omit \`id\` to create; \`title: <title>\`, \`description: <description>\`) in the active Linear team/project for this repo (ask if ambiguous), and note the new issue's id from the response${RECEIPT}`;

      // Comment discovery must go through list_comments — get_issue does not return
      // comments, and an agent that looks there concludes the artifact doesn't exist.
      case 'getWorkArtifact':
        return `list the ticket's comments with the Linear MCP **list_comments** tool (\`issueId: ${t}\`) and find the one containing \`${ARTIFACT_SENTINEL}\` — that is the work artifact`;

      case 'upsertWorkArtifact':
        return `upsert the work-artifact comment: list the ticket's comments with the Linear MCP **list_comments** tool (\`issueId: ${t}\`) and find the one containing \`${ARTIFACT_SENTINEL}\`; if found, **update it in place** with the Linear MCP **save_comment** tool (pass its comment id); if none exists, create it (\`issueId: ${t}\`). Never post a second copy${RECEIPT}`;

      default:
        return `[[unknown op: ${name}]]`;
    }
  },
};
