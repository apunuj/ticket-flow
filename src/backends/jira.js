// Jira backend adapter. Same abstract interface as Linear, but Jira's semantics differ:
//   - grouping is by SPRINT (or fix version), not Linear milestones
//   - state changes go through TRANSITIONS (named workflow transitions), not a direct state set
//   - PR linkage is the development panel / remote links (smart commits auto-link), not attachments
// Tool names are kept descriptive ("the Jira MCP transition-issue tool") because the exact tool
// ids vary by Jira MCP implementation (Atlassian Remote MCP vs community servers); the agent
// resolves them. The work artifact still lives in a marked comment — comments are universal.

import { ARTIFACT_SENTINEL } from '../artifact.js';
import { RECEIPT } from './_receipt.js';

const id = 'jira';

export default {
  id,
  displayName: 'Jira',
  groupingNoun: 'sprint',
  groupingNounPlural: 'sprints',
  capabilities: { groups: true, attachments: false, groupTargetDates: true },
  // Backend-neutral facts read by shared templates. Counterparts of linear.js's; Jira's
  // priority scheme runs Highest→Lowest, sprints carry an end date, and closed sprints read
  // "closed" rather than Linear's completed/cancelled.
  priorityScale: 'Highest > High > Medium > Low > Lowest',
  groupDateNoun: 'end date',
  groupClosedStatuses: 'closed',
  requires:
    'an Atlassian/Jira MCP server connected in your tool, exposing get-issue, JQL search, transition-issue, create-issue, add-comment, and edit-comment operations (e.g. the Atlassian Remote MCP).',
  // Atlassian Rovo remote MCP server (streamable HTTP). OAuth on first connect. `ticket-flow
  // build` scaffolds this into each tool's MCP config so connecting is a one-time approval.
  mcp: { name: 'atlassian', url: 'https://mcp.atlassian.com/v1/mcp' },

  op(name, params, ctx) {
    const t = ctx.ticket;
    const states = (ctx.config.backend && ctx.config.backend.states) || {};
    const project =
      (params && params.project) || (ctx.config.backend && ctx.config.backend.project) || '';

    switch (name) {
      case 'getTicket':
        return `fetch the issue with the Jira MCP **get-issue** tool (\`issueKey: ${t}\`), including status, description, comments, and linked PRs`;

      case 'listBacklog': {
        const backlog = states.backlog || 'Backlog';
        return project
          ? `search backlog issues with the Jira MCP **JQL search** tool: \`project = "${project}" AND status = "${backlog}" ORDER BY priority DESC, updated DESC\` (limit 30)`
          : `search backlog issues with the Jira MCP **JQL search** tool: \`status = "${backlog}" ORDER BY priority DESC, updated DESC\` (limit 30), scoped to the Jira project for this repo (add \`project = "<KEY>"\` once resolved); if the project is ambiguous, ask which one to use`;
      }

      case 'listGroups':
        return `list the active and future **sprints** for the project's board (Jira MCP sprint/board listing), each with a name and end date. If the project is Kanban (no sprints), fall back to fix versions, and if neither exists treat all tickets as one ungrouped list`;

      case 'setState': {
        const display = states[params.state] || params.state;
        return `**transition** the issue to **${display}** with the Jira MCP **transition-issue** tool (\`issueKey: ${t}\`, choose the transition whose target status is "${display}")${RECEIPT}`;
      }

      case 'attachPR':
        return `link the PR to the issue: add it as a **remote link** (or a comment containing the PR URL) with the Jira MCP. If smart commits / the GitHub-for-Jira integration are enabled the development panel auto-links it; the comment guarantees a discoverable link regardless — skip if the same PR is already linked${RECEIPT}`;

      case 'getAttachedPR':
        return `read the issue's **development panel** / remote links / comments (Jira MCP **get-issue** on \`${t}\`) for the GitHub PR URL; cross-check with \`gh pr list --search "${t}"\` if missing`;

      case 'addComment':
        return `add a comment to the issue with the Jira MCP **add-comment** tool (\`issueKey: ${t}\`)${RECEIPT}`;

      case 'createTicket':
        return project
          ? `create a new issue with the Jira MCP **create-issue** tool (\`project: "${project}"\`, \`summary: <title>\`, \`description: <description>\`), and note the new issue key from the response${RECEIPT}`
          : `create a new issue with the Jira MCP **create-issue** tool (\`summary: <title>\`, \`description: <description>\`), using the Jira project key for this repo (ask if ambiguous), and note the new issue key from the response${RECEIPT}`;

      case 'getWorkArtifact':
        return `read the issue comments (Jira MCP **get-issue** on \`${t}\`) and find the one containing \`${ARTIFACT_SENTINEL}\` — that is the work artifact`;

      case 'upsertWorkArtifact':
        return `upsert the work-artifact comment: find the existing comment containing \`${ARTIFACT_SENTINEL}\` and **update it in place** with the Jira MCP **edit-comment** tool (pass its comment id); if none exists, add it (\`issueKey: ${t}\`). Never post a second copy${RECEIPT}`;

      default:
        return `[[unknown op: ${name}]]`;
    }
  },
};
