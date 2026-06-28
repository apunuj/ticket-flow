import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatter, usageLine } from '../src/render/_frontmatter.js';
import { getTool, tools } from '../src/render/index.js';

test('frontmatter emits a fenced YAML block', () => {
  const out = frontmatter({ name: 'x', description: 'y' });
  assert.equal(out, '---\nname: x\ndescription: y\n---\n');
});

test('frontmatter drops undefined / null / empty values', () => {
  const out = frontmatter({ a: 1, b: undefined, c: null, d: '', e: 'keep' });
  assert.match(out, /a: 1/);
  assert.match(out, /e: keep/);
  for (const k of ['b:', 'c:', 'd:']) assert.ok(!out.includes(k), `${k} should be dropped`);
});

test('frontmatter preserves key insertion order', () => {
  const out = frontmatter({ name: 'n', description: 'd', 'argument-hint': 'h' });
  assert.ok(out.indexOf('name:') < out.indexOf('description:'));
  assert.ok(out.indexOf('description:') < out.indexOf('argument-hint:'));
});

test('usageLine renders only when an argument-hint exists', () => {
  assert.equal(usageLine({ name: 'next-ticket', 'argument-hint': '[project]' }), '> Usage: `/next-ticket [project]`\n\n');
  assert.equal(usageLine({ name: 'next-ticket' }), '');
});

test('getTool returns each registered renderer', () => {
  for (const id of ['claude', 'copilot', 'opencode']) {
    assert.equal(getTool(id).id, id);
  }
  assert.deepEqual(Object.keys(tools).sort(), ['claude', 'copilot', 'opencode']);
});

test('getTool throws and lists options for an unknown tool', () => {
  assert.throws(() => getTool('cursor'), (e) => {
    assert.match(e.message, /Unknown tool "cursor"/);
    assert.match(e.message, /claude/);
    return true;
  });
});

test('renderer argToken differs (positional vs named input)', () => {
  assert.equal(getTool('claude').argToken({}), '$1');
  assert.equal(getTool('opencode').argToken({}), '$1');
  assert.equal(getTool('copilot').argToken({}), '${input:ticket}');
  assert.equal(getTool('copilot').argToken({ argName: 'project' }), '${input:project}');
});

test('every renderer defines the conversational hooks', () => {
  for (const id of ['claude', 'copilot', 'opencode']) {
    assert.equal(typeof getTool(id).extras, 'function', `${id} should define extras()`);
    assert.equal(typeof getTool(id).skillRef, 'function', `${id} should define skillRef()`);
  }
});

test('each renderer maps a backend to its tool-specific MCP config shape', () => {
  const backend = { mcp: { name: 'linear', url: 'https://mcp.linear.app/mcp' } };

  const c = getTool('claude').mcpFile(backend);
  assert.equal(c.path, '.mcp.json');
  assert.equal(c.key, 'mcpServers');
  assert.deepEqual(c.server, { type: 'http', url: backend.mcp.url });

  const g = getTool('copilot').mcpFile(backend);
  assert.equal(g.path, '.vscode/mcp.json');
  assert.equal(g.key, 'servers');
  assert.equal(g.server.type, 'http');

  const o = getTool('opencode').mcpFile(backend);
  assert.equal(o.path, 'opencode.json');
  assert.equal(o.key, 'mcp');
  assert.deepEqual(o.server, { type: 'remote', url: backend.mcp.url, enabled: true });
});
