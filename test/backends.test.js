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
}

test('backend-specific tool vocabulary differs (set vs transition, attach vs link)', () => {
  const lin = getBackend('linear');
  const jira = getBackend('jira');
  assert.match(lin.op('setState', { state: 'done' }, ctx()), /save_issue/);
  assert.match(jira.op('setState', { state: 'done' }, ctx()), /transition/);
  assert.match(lin.op('attachPR', {}, ctx()), /create_attachment/);
  assert.match(jira.op('attachPR', {}, ctx()), /remote link/);
});

test('op honors an explicit project override in params', () => {
  const out = getBackend('linear').op('listBacklog', { project: 'Other Project' }, ctx());
  assert.match(out, /Other Project/);
});

test('each backend declares its remote MCP server (streamable HTTP /mcp endpoint)', () => {
  assert.equal(backends.linear.mcp.name, 'linear');
  assert.equal(backends.linear.mcp.url, 'https://mcp.linear.app/mcp');
  assert.equal(backends.jira.mcp.name, 'atlassian');
  assert.equal(backends.jira.mcp.url, 'https://mcp.atlassian.com/v1/mcp');
  for (const b of Object.values(backends)) assert.ok(!/\/sse$/.test(b.mcp.url), 'no deprecated SSE endpoint');
});
