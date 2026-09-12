import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { parseConfig } from '../src/config.js';
import { runAdd, runRemove, writeToolsList, ALL_TOOL_IDS } from '../src/cli/tools.js';
import { build } from '../src/build.js';
import { parseTools } from '../src/cli/init.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8');

// A throwaway repo with a config whose tools: list is `tools`, already built.
function withRepo(tools, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-tools-'));
  try {
    const yaml = EXAMPLE.replace(
      /^tools:.*?(?=\n\w)/ms,
      typeof tools === 'string' ? `tools: ${tools}\n` : `tools:\n${tools.map((t) => `  - ${t}`).join('\n')}\n`,
    );
    const cfgPath = path.join(dir, 'ticket-flow.config.yaml');
    fs.writeFileSync(cfgPath, yaml);
    build(parseConfig(yaml), { outputDir: dir });
    fn({ dir, cfgPath, opts: { configPath: cfgPath, out: dir, cwd: dir } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const toolsIn = (cfgPath) => YAML.parse(fs.readFileSync(cfgPath, 'utf8')).tools;

test('add writes the new tool into the config and generates only its files', () => {
  withRepo(['claude'], ({ dir, cfgPath, opts }) => {
    const res = runAdd({ ...opts, tools: ['codex'] });

    assert.deepEqual(res.added, ['codex']);
    assert.deepEqual(toolsIn(cfgPath), ['claude', 'codex'], 'config gained codex');
    assert.ok(fs.existsSync(path.join(dir, '.agents/skills/describe-ticket/SKILL.md')));
    assert.ok(fs.existsSync(path.join(dir, '.codex/config.toml')), 'its MCP config is scaffolded too');
    assert.ok(fs.existsSync(path.join(dir, '.claude/skills/describe-ticket/SKILL.md')), 'claude untouched');
  });
});

test('add is idempotent — a configured tool is reported, not duplicated', () => {
  withRepo(['claude', 'codex'], ({ cfgPath, opts }) => {
    const res = runAdd({ ...opts, tools: ['codex'] });
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.already, ['codex']);
    assert.deepEqual(toolsIn(cfgPath), ['claude', 'codex'], 'no duplicate entry');
  });
});

test('add validates every id before touching the config', () => {
  withRepo(['claude'], ({ cfgPath, opts }) => {
    assert.throws(
      () => runAdd({ ...opts, tools: ['codex', 'windsurf'] }),
      /Unknown tool "windsurf"/,
    );
    assert.deepEqual(toolsIn(cfgPath), ['claude'], 'a bad id in the batch applies nothing');
  });
});

test('add on a `tools: all` config leaves the config alone', () => {
  withRepo('all', ({ cfgPath, opts }) => {
    const res = runAdd({ ...opts, tools: ['cursor'] });
    assert.ok(res.all, 'reported as an all-tools config');
    assert.equal(toolsIn(cfgPath), 'all', '`all` is not expanded by add');
    assert.deepEqual(res.tools, ALL_TOOL_IDS);
  });
});

test('remove drops the tool from the config and prunes the files it owned', () => {
  withRepo(['claude', 'codex'], ({ dir, cfgPath, opts }) => {
    const res = runRemove({ ...opts, tools: ['claude'] });

    assert.deepEqual(res.removed, ['claude']);
    assert.deepEqual(toolsIn(cfgPath), ['codex']);
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'the emptied directory is cleaned up too');
    assert.ok(res.pruned.includes('.claude/skills/describe-ticket/SKILL.md'));
    assert.ok(fs.existsSync(path.join(dir, '.agents/skills/describe-ticket/SKILL.md')), 'codex survives');
    // MCP configs carry the user's own settings, so they are never pruned
    assert.ok(fs.existsSync(path.join(dir, '.mcp.json')), 'the MCP config is left in place');
  });
});

test('remove expands `tools: all` rather than letting the next build re-add the tool', () => {
  withRepo('all', ({ dir, cfgPath, opts }) => {
    runRemove({ ...opts, tools: ['copilot'] });
    const after = toolsIn(cfgPath);
    assert.ok(Array.isArray(after), '`all` became an explicit list');
    assert.ok(!after.includes('copilot'));
    assert.deepEqual(after, ALL_TOOL_IDS.filter((t) => t !== 'copilot'));
    assert.ok(!fs.existsSync(path.join(dir, '.github/prompts')), 'copilot prompts pruned');
  });
});

test('remove refuses to empty the tools list', () => {
  withRepo(['claude'], ({ cfgPath, opts }) => {
    assert.throws(() => runRemove({ ...opts, tools: ['claude'] }), /Refusing to remove every tool/);
    assert.deepEqual(toolsIn(cfgPath), ['claude'], 'config untouched');
  });
});

test('remove reports a tool that was never configured without changing anything', () => {
  withRepo(['claude'], ({ cfgPath, opts }) => {
    const res = runRemove({ ...opts, tools: ['cursor'] });
    assert.deepEqual(res.absent, ['cursor']);
    assert.deepEqual(res.removed, []);
    assert.deepEqual(toolsIn(cfgPath), ['claude']);
  });
});

test('writeToolsList keeps comments and unrelated keys in the config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-tools-'));
  try {
    const f = path.join(dir, 'c.yaml');
    fs.writeFileSync(f, '# top comment\nproject:\n  name: Demo\ntools:\n  - claude\n\ntest:\n  command: npm test\n');
    writeToolsList(f, ['claude', 'cursor']);
    const out = fs.readFileSync(f, 'utf8');
    assert.match(out, /^# top comment/, 'leading comment survives');
    assert.match(out, /name: Demo/, 'unrelated keys survive');
    assert.match(out, /command: npm test/);
    assert.deepEqual(YAML.parse(out).tools, ['claude', 'cursor']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseTools keeps "all" literal so later ticket-flow versions widen it for free', () => {
  assert.equal(parseTools('all'), 'all');
  assert.equal(parseTools(' ALL '), 'all');
  assert.deepEqual(parseTools('claude, cursor'), ['claude', 'cursor']);
  // "all" only counts on its own — mixed input is taken at face value and fails validation
  assert.deepEqual(parseTools('all,claude'), ['all', 'claude']);
});

test('`tools: all` renders every registered tool', () => {
  const cfg = parseConfig(EXAMPLE.replace(/^tools:.*?(?=\n\w)/ms, 'tools: all\n'));
  assert.deepEqual(cfg.tools, ALL_TOOL_IDS);
});
