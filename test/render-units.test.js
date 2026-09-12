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

const TOOL_IDS = ['claude', 'codex', 'copilot', 'cursor', 'opencode'];

test('getTool returns each registered renderer', () => {
  for (const id of TOOL_IDS) {
    assert.equal(getTool(id).id, id);
  }
  assert.deepEqual(Object.keys(tools).sort(), TOOL_IDS);
});

test('getTool throws and lists options for an unknown tool', () => {
  assert.throws(() => getTool('windsurf'), (e) => {
    assert.match(e.message, /Unknown tool "windsurf"/);
    assert.match(e.message, /claude/);
    return true;
  });
});

test('renderer argToken differs (positional, named input, or a placeholder)', () => {
  assert.equal(getTool('claude').argToken({}), '$1');
  assert.equal(getTool('opencode').argToken({}), '$1');
  assert.equal(getTool('copilot').argToken({}), '${input:ticket}');
  assert.equal(getTool('copilot').argToken({ argName: 'project' }), '${input:project}');
  // cursor + codex substitute nothing, so the token must be a readable placeholder the
  // argument guard recovers from — never a literal $1 the agent would see unexpanded.
  for (const id of ['cursor', 'codex']) {
    assert.equal(getTool(id).argToken({}), '<ticket-id>');
    assert.equal(getTool(id).argToken({ argName: 'project' }), '<project>');
    assert.equal(getTool(id).argToken({ argMode: 'all' }), '<ticket-ids>');
  }
});

test('every renderer defines the conversational hooks', () => {
  for (const id of TOOL_IDS) {
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

  const cu = getTool('cursor').mcpFile(backend);
  assert.equal(cu.path, '.cursor/mcp.json');
  assert.equal(cu.key, 'mcpServers');
  assert.deepEqual(cu.server, { url: backend.mcp.url });

  // codex is the only TOML config — the flag is what routes build/doctor away from JSON
  const cx = getTool('codex').mcpFile(backend);
  assert.equal(cx.path, '.codex/config.toml');
  assert.equal(cx.format, 'toml');
  assert.equal(cx.key, 'mcp_servers');
  assert.deepEqual(cx.server, { url: backend.mcp.url });
});
