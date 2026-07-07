import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBackend, backends } from '../src/backends/index.js';
import { ARTIFACT_SENTINEL } from '../src/artifact.js';

const ctx = () => ({
  ticket: 'PROJ-1',
  config: {
    backend: {
      project: 'My Project',
      states: { backlog: 'Backlog', inProgress: 'In Progress', inReview: 'In Review', done: 'Done' },
    },
  },
});

test('getBackend returns the registered adapters', () => {
  assert.equal(getBackend('linear').id, 'linear');
  assert.equal(getBackend('jira').id, 'jira');
});

test('getBackend throws and lists options for an unknown backend', () => {
  assert.throws(() => getBackend('github'), (e) => {
    assert.match(e.message, /Unknown backend "github"/);
    assert.match(e.message, /linear/);
    assert.match(e.message, /jira/);
    return true;
  });
});

test('adapters expose distinct grouping + capabilities', () => {
  assert.equal(backends.linear.groupingNoun, 'milestone');
  assert.equal(backends.jira.groupingNoun, 'sprint');
  assert.equal(backends.linear.capabilities.attachments, true);
  assert.equal(backends.jira.capabilities.attachments, false, 'jira links PRs, not attaches');
  for (const b of Object.values(backends)) {
    assert.equal(typeof b.requires, 'string');
    assert.ok(b.requires.length > 0);
  }
});

for (const type of ['linear', 'jira']) {
  const b = getBackend(type);

  test(`[${type}] op() interpolates the ticket token and project`, () => {
    assert.match(b.op('getTicket', {}, ctx()), /PROJ-1/);
    assert.match(b.op('listBacklog', {}, ctx()), /My Project/);
  });

  test(`[${type}] setState resolves the configured display name`, () => {
    const out = b.op('setState', { state: 'inReview' }, ctx());
    assert.match(out, /In Review/);
  });

  test(`[${type}] work-artifact ops reference the shared sentinel`, () => {
    assert.ok(b.op('getWorkArtifact', {}, ctx()).includes(ARTIFACT_SENTINEL));
    assert.ok(b.op('upsertWorkArtifact', {}, ctx()).includes(ARTIFACT_SENTINEL));
  });

  test(`[${type}] an unknown op degrades to a visible marker`, () => {
    assert.equal(b.op('frobnicate', {}, ctx()), '[[unknown op: frobnicate]]');
  });

  // APU-788: createTicket backs the batch deferred-findings ticket in orchestrate-ticket.
  test(`[${type}] createTicket creates in the configured project with a title and description`, () => {
    const out = b.op('createTicket', {}, ctx());
    assert.match(out, /create/i, `[${type}] instructs a create`);
    assert.match(out, /My Project/, `[${type}] scoped to the configured project`);
    assert.match(out, /title|summary/i, `[${type}] passes the title`);
    assert.match(out, /description/i, `[${type}] passes the description`);
  });

  test(`[${type}] createTicket resolves the project at runtime when none is configured`, () => {
    const out = b.op('createTicket', {}, ctxNoProject());
    assert.doesNotMatch(out, /""/, `[${type}] no empty-string project leaks`);
    assert.match(out, /repo|active|ambiguous|resolve/i, `[${type}] runtime-resolution guidance`);
  });
}

test('backend-specific tool vocabulary differs (set vs transition, attach vs link)', () => {
  const lin = getBackend('linear');
  const jira = getBackend('jira');
  assert.match(lin.op('setState', { state: 'done' }, ctx()), /save_issue/);
  assert.match(jira.op('setState', { state: 'done' }, ctx()), /transition/);
  // Linear's create_attachment uploads files (base64) — URL links go through save_issue.links.
  assert.match(lin.op('attachPR', {}, ctx()), /save_issue/);
  assert.match(lin.op('attachPR', {}, ctx()), /links/);
  assert.doesNotMatch(lin.op('attachPR', {}, ctx()), /create_attachment/);
  assert.match(jira.op('attachPR', {}, ctx()), /remote link/);
  // Linear creates via save_issue (no id); Jira has a dedicated create-issue tool.
  assert.match(lin.op('createTicket', {}, ctx()), /save_issue/);
  assert.match(jira.op('createTicket', {}, ctx()), /create-issue/);
});

test('op honors an explicit project override in params', () => {
  const out = getBackend('linear').op('listBacklog', { project: 'Other Project' }, ctx());
  assert.match(out, /Other Project/);
});

const ctxNoProject = () => ({
  ticket: 'PROJ-1',
  config: { backend: { states: { backlog: 'Backlog', inReview: 'In Review', done: 'Done' } } },
});

test('listBacklog omits an empty project filter and gives runtime guidance when none is set', () => {
  for (const type of ['linear', 'jira']) {
    const out = getBackend(type).op('listBacklog', {}, ctxNoProject());
    assert.doesNotMatch(out, /""/, `[${type}] no empty-string project leaks`);
    assert.match(out, /repo|active|ambiguous|resolve/i, `[${type}] runtime-resolution guidance`);
  }
});

test('linear listGroups still works without a configured project', () => {
  const out = getBackend('linear').op('listGroups', {}, ctxNoProject());
  assert.match(out, /list_milestones/);
  assert.doesNotMatch(out, /""/, 'no empty-string project leaks');
});

// APU-719: Linear's get_issue does not return comments — every comment-discovery
// instruction must route through list_comments or agents conclude "no artifact exists".
test('[linear] comment discovery goes through list_comments, never get_issue', () => {
  const lin = getBackend('linear');
  assert.match(lin.op('getWorkArtifact', {}, ctx()), /list_comments/);
  assert.match(lin.op('upsertWorkArtifact', {}, ctx()), /list_comments/);
  assert.match(lin.op('getAttachedPR', {}, ctx()), /list_comments/);
  assert.doesNotMatch(
    lin.op('getWorkArtifact', {}, ctx()),
    /get_issue/,
    'get_issue cannot be the comment source — it does not return comments',
  );
  assert.match(backends.linear.requires, /list_comments/, 'requires advertises the read tool');
});

// APU-719: no backend write may fail silently — every mutating op carries the receipt clause.
const MUTATING_OPS = ['addComment', 'upsertWorkArtifact', 'setState', 'attachPR', 'createTicket'];
for (const type of ['linear', 'jira']) {
  test(`[${type}] mutating ops carry the write-receipt clause`, () => {
    const b = getBackend(type);
    for (const op of MUTATING_OPS) {
      const out = b.op(op, op === 'setState' ? { state: 'done' } : {}, ctx());
      assert.match(out, /verify the write/i, `[${type}] ${op} verifies the response`);
      assert.match(out, /never continue silently/i, `[${type}] ${op} fails loudly`);
    }
  });
}

test('each backend declares its remote MCP server (streamable HTTP /mcp endpoint)', () => {
  assert.equal(backends.linear.mcp.name, 'linear');
  assert.equal(backends.linear.mcp.url, 'https://mcp.linear.app/mcp');
  assert.equal(backends.jira.mcp.name, 'atlassian');
  assert.equal(backends.jira.mcp.url, 'https://mcp.atlassian.com/v1/mcp');
  for (const b of Object.values(backends)) assert.ok(!/\/sse$/.test(b.mcp.url), 'no deprecated SSE endpoint');
});
