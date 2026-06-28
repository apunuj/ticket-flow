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

test('only copilot + opencode define the conversational hooks', () => {
  assert.equal(typeof getTool('copilot').extras, 'function');
  assert.equal(typeof getTool('opencode').extras, 'function');
  assert.equal(typeof getTool('claude').extras, 'undefined', 'claude needs no guide file');
  assert.equal(typeof getTool('copilot').skillRef, 'function');
  assert.equal(typeof getTool('opencode').skillRef, 'function');
});
