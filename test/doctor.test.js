import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { build } from '../src/build.js';
import {
  checkConfig,
  checkDrift,
  checkMcp,
  checkOrchestrate,
  checkToolOverlap,
  checkUngeneratedAgents,
} from '../src/cli/doctor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseConfig = () =>
  parseConfig(fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8'));

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-doc-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('checkConfig fails clearly on a missing config', () => {
  const r = checkConfig(path.join(ROOT, 'no-such-config.yaml'));
  assert.equal(r.status, 'fail');
  assert.match(r.fix, /ticket-flow init/);
});

test('checkConfig passes for a valid config and returns it', () => {
  const r = checkConfig(path.join(ROOT, 'examples', 'example.config.yaml'));
  assert.equal(r.status, 'ok');
  assert.equal(r.config.backend.type, 'linear');
});

test('checkDrift: ok after build, warn on drift, fail when missing', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    build(cfg, { outputDir: dir });
    assert.equal(checkDrift(cfg, dir).status, 'ok');

    const skill = path.join(dir, '.claude/skills/next-ticket/SKILL.md');
    fs.appendFileSync(skill, '\n<!-- hand edit -->\n');
    assert.equal(checkDrift(cfg, dir).status, 'warn', 'detects an out-of-date file');

    fs.rmSync(skill);
    assert.equal(checkDrift(cfg, dir).status, 'fail', 'detects a missing file');
  });
});

// APU-795 (T6, finding 8): a half-configured orchestrate split (exactly one model) is a
// warn — it silently falls back to asking every run. Empty string counts as unset, mirroring
// the render `and` helper. Both set or both unset is ok.
test('checkOrchestrate: ok when both models set or both unset, warn on exactly one', () => {
  const base = baseConfig();
  assert.equal(checkOrchestrate(base).status, 'ok', 'both unset (fixture block commented)');

  const both = { ...base, orchestrate: { plannerModel: 'opus', implementerModel: 'sonnet' } };
  assert.equal(checkOrchestrate(both).status, 'ok', 'both set');

  const plannerOnly = { ...base, orchestrate: { plannerModel: 'opus' } };
  const r1 = checkOrchestrate(plannerOnly);
  assert.equal(r1.status, 'warn', 'only planner set');
  assert.match(r1.detail, /implementer/i, 'names the missing implementer role');

  const implOnly = { ...base, orchestrate: { implementerModel: 'sonnet' } };
  const r2 = checkOrchestrate(implOnly);
  assert.equal(r2.status, 'warn', 'only implementer set');
  assert.match(r2.detail, /planner/i, 'names the missing planner role');

  const emptyPlanner = { ...base, orchestrate: { plannerModel: '', implementerModel: 'sonnet' } };
  assert.equal(checkOrchestrate(emptyPlanner).status, 'warn', 'empty string counts as unset');
});

test('checkMcp: ok after build, warns when a tool MCP config is absent', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    build(cfg, { outputDir: dir });
    assert.equal(checkMcp(cfg, dir).status, 'ok');

    fs.rmSync(path.join(dir, '.mcp.json'));
    const r = checkMcp(cfg, dir);
    assert.equal(r.status, 'warn');
    assert.match(r.detail, /claude/);
  });
});

test('checkMcp reads codex\'s TOML config, not JSON', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    cfg.tools = ['codex'];
    build(cfg, { outputDir: dir });
    assert.equal(checkMcp(cfg, dir).status, 'ok', 'a TOML table counts as configured');

    // a config.toml without the server table reads as missing, not as unparseable JSON
    fs.writeFileSync(path.join(dir, '.codex/config.toml'), 'model = "gpt-5"\n');
    const r = checkMcp(cfg, dir);
    assert.equal(r.status, 'warn');
    assert.match(r.detail, /codex \(\.codex\/config\.toml\)/);
  });
});

test('checkToolOverlap: warns only when cursor and codex are configured together', () => {
  const cfg = baseConfig();
  assert.equal(checkToolOverlap({ tools: ['cursor', 'codex'] }).status, 'warn');
  assert.match(checkToolOverlap({ tools: ['cursor', 'codex'] }).detail, /\.agents\/skills\//);
  assert.equal(checkToolOverlap(cfg).status, 'warn', 'the example config enables both');
  for (const tools of [['cursor'], ['codex'], ['claude', 'copilot', 'opencode'], []]) {
    assert.equal(checkToolOverlap({ tools }).status, 'ok', `${tools.join('+') || 'none'} has no overlap`);
  }
});

test('checkUngeneratedAgents: flags an agent set up in the repo that is not generated for', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    cfg.tools = ['claude'];

    assert.equal(checkUngeneratedAgents(cfg, dir).status, 'ok', 'nothing else present');

    // the developer set Cursor up themselves — ticket-flow never wrote .cursor/ here
    fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
    const r = checkUngeneratedAgents(cfg, dir);
    assert.equal(r.status, 'warn');
    assert.match(r.detail, /cursor/);
    assert.match(r.fix, /ticket-flow add cursor/, 'names the exact command to fix it');

    // a configured tool's own directory is never reported back at you
    cfg.tools = ['claude', 'cursor'];
    assert.equal(checkUngeneratedAgents(cfg, dir).status, 'ok');
  });
});

test('checkUngeneratedAgents does not mistake a plain .github for Copilot', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    cfg.tools = ['claude'];
    // almost every repo has .github/workflows — only Copilot's own paths count as a signal
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    assert.equal(checkUngeneratedAgents(cfg, dir).status, 'ok');

    fs.mkdirSync(path.join(dir, '.github', 'prompts'), { recursive: true });
    assert.equal(checkUngeneratedAgents(cfg, dir).status, 'warn');
  });
});
