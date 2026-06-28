import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const EXAMPLE = path.join(ROOT, 'examples', 'example.config.yaml');

// Invoke the real binary in a child process; capture output + exit code either way.
function run(args, opts = {}) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('no args prints usage and exits 0', () => {
  const { code, out } = run([]);
  assert.equal(code, 0);
  assert.match(out, /Usage:/);
  assert.match(out, /next-ticket → describe-ticket/);
});

test('help is reachable via `help`, `--help`, and `-h`', () => {
  for (const arg of ['help', '--help', '-h']) {
    const { code, out } = run([arg]);
    assert.equal(code, 0, `\`${arg}\` should exit 0`);
    assert.match(out, /Usage:/, `\`${arg}\` should print usage`);
  }
});

test('an unknown command exits 1 with a clear message', () => {
  const { code, out } = run(['frobnicate']);
  assert.equal(code, 1);
  assert.match(out, /Unknown command: frobnicate/);
});

test('check on a missing config exits 1 with the helpful error', () => {
  const { code, out } = run(['check', '--config', '/no/such/file.yaml']);
  assert.equal(code, 1);
  assert.match(out, /Config not found/);
});

test('init creates the config and reports it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bin-'));
  try {
    const { code, out } = run(['init'], { cwd: dir });
    assert.equal(code, 0);
    assert.match(out, /Created ticket-flow\.config\.yaml/);
    assert.ok(fs.existsSync(path.join(dir, 'ticket-flow.config.yaml')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build renders from --config to --out end to end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bin-'));
  try {
    const { code, out } = run(['build', '--config', EXAMPLE, '--out', dir]);
    assert.equal(code, 0);
    assert.match(out, /Built 18 files/);
    assert.match(out, /always-on guide/);
    assert.ok(fs.existsSync(path.join(dir, '.claude/skills/merge-ticket/SKILL.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
