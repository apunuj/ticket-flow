import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { build } from '../src/build.js';
import { checkConfig, checkDrift, checkMcp } from '../src/cli/doctor.js';

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
