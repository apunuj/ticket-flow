import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { renderAll, build, wireOpencodeInstructions } from '../src/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseConfig = () =>
  parseConfig(fs.readFileSync(path.join(ROOT, 'examples', 'example.config.yaml'), 'utf8'));

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-build-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('renderAll tags every file with a kind', () => {
  const files = renderAll(baseConfig());
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(['skill', 'guide'].includes(f.kind), `unexpected kind ${f.kind}`);
});

test('build writes the full file set for all three tools', () => {
  withTmp((dir) => {
    build(baseConfig(), { outputDir: dir });
    const expect = [
      '.claude/skills/execute-ticket/SKILL.md',
      '.github/prompts/execute-ticket.prompt.md',
      '.github/instructions/ticket-flow.instructions.md',
      '.opencode/command/execute-ticket.md',
      '.opencode/ticket-flow.md',
      'opencode.json',
    ];
    for (const rel of expect) assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
  });
});

test('build for claude only writes nothing for other tools', () => {
  withTmp((dir) => {
    const cfg = baseConfig();
    cfg.tools = ['claude'];
    build(cfg, { outputDir: dir });
    assert.ok(fs.existsSync(path.join(dir, '.claude')));
    assert.ok(!fs.existsSync(path.join(dir, '.github')), 'no copilot output');
    assert.ok(!fs.existsSync(path.join(dir, '.opencode')), 'no opencode output');
    assert.ok(!fs.existsSync(path.join(dir, 'opencode.json')), 'no opencode wiring');
  });
});

test('wireOpencodeInstructions: create -> already wired -> merge', () => {
  withTmp((dir) => {
    const jsonPath = path.join(dir, 'opencode.json');

    assert.equal(wireOpencodeInstructions(dir).action, 'created');
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).instructions, [
      './.opencode/ticket-flow.md',
    ]);

    assert.equal(wireOpencodeInstructions(dir).action, 'already wired');

    fs.writeFileSync(jsonPath, JSON.stringify({ instructions: ['./house-rules.md'] }, null, 2));
    assert.equal(wireOpencodeInstructions(dir).action, 'merged');
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).instructions, [
      './house-rules.md',
      './.opencode/ticket-flow.md',
    ]);
  });
});

test('wireOpencodeInstructions never clobbers an existing opencode.jsonc', () => {
  withTmp((dir) => {
    const jsoncPath = path.join(dir, 'opencode.jsonc');
    fs.writeFileSync(jsoncPath, '{\n  // user config\n  "instructions": []\n}\n');
    const res = wireOpencodeInstructions(dir);
    assert.match(res.action, /^manual/, 'defers to the user');
    assert.ok(!fs.existsSync(path.join(dir, 'opencode.json')), 'does not create a competing file');
  });
});

test('wireOpencodeInstructions leaves an unparseable opencode.json untouched', () => {
  withTmp((dir) => {
    const jsonPath = path.join(dir, 'opencode.json');
    const original = '{ this is not valid json ]';
    fs.writeFileSync(jsonPath, original);
    const res = wireOpencodeInstructions(dir);
    assert.match(res.action, /^manual/);
    assert.equal(fs.readFileSync(jsonPath, 'utf8'), original, 'file is unchanged');
  });
});
