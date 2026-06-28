import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { renderAll, build, wireOpencodeInstructions, mergeMcpServer } from '../src/build.js';

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
  for (const f of files)
    assert.ok(['skill', 'guide', 'overview'].includes(f.kind), `unexpected kind ${f.kind}`);
});

test('build writes the full file set for all three tools', () => {
  withTmp((dir) => {
    build(baseConfig(), { outputDir: dir });
    const expect = [
      '.claude/skills/execute-ticket/SKILL.md',
      '.claude/skills/ticket-flow/SKILL.md',
      '.github/prompts/execute-ticket.prompt.md',
      '.github/instructions/ticket-flow.instructions.md',
      '.opencode/command/execute-ticket.md',
      '.opencode/ticket-flow.md',
      'opencode.json',
      'TICKET-FLOW.md',
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
    assert.ok(fs.existsSync(path.join(dir, '.mcp.json')), 'scaffolds the Claude MCP config');
    assert.ok(!fs.existsSync(path.join(dir, '.github')), 'no copilot output');
    assert.ok(!fs.existsSync(path.join(dir, '.opencode')), 'no opencode output');
    assert.ok(!fs.existsSync(path.join(dir, 'opencode.json')), 'no opencode wiring');
    assert.ok(!fs.existsSync(path.join(dir, '.vscode')), 'no vscode mcp config');
  });
});

test('build scaffolds each tool MCP config with the right shape', () => {
  withTmp((dir) => {
    build(baseConfig(), { outputDir: dir }); // example config -> linear backend

    const claude = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    assert.deepEqual(claude.mcpServers.linear, { type: 'http', url: 'https://mcp.linear.app/mcp' });

    const vscode = JSON.parse(fs.readFileSync(path.join(dir, '.vscode/mcp.json'), 'utf8'));
    assert.equal(vscode.servers.linear.type, 'http');

    // opencode MCP merges into the same opencode.json that holds the instructions wiring
    const oc = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
    assert.deepEqual(oc.mcp.linear, { type: 'remote', url: 'https://mcp.linear.app/mcp', enabled: true });
    assert.ok(Array.isArray(oc.instructions), 'instructions wiring preserved alongside mcp');
  });
});

test('mergeMcpServer: create, non-clobbering merge, idempotent, unparseable-skip', () => {
  withTmp((dir) => {
    const f = path.join(dir, '.mcp.json');
    const srv = { type: 'http', url: 'https://mcp.linear.app/mcp' };

    assert.equal(mergeMcpServer(f, 'mcpServers', 'linear', srv).action, 'created');

    // preserves a user's other servers + other top-level keys
    fs.writeFileSync(
      f,
      JSON.stringify({ $custom: 1, mcpServers: { mine: { type: 'http', url: 'x' } } }, null, 2),
    );
    assert.equal(mergeMcpServer(f, 'mcpServers', 'linear', srv).action, 'merged');
    const merged = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(merged.$custom, 1);
    assert.ok(merged.mcpServers.mine, 'user server kept');
    assert.deepEqual(merged.mcpServers.linear, srv);

    // idempotent — does not overwrite an existing entry for the same server
    assert.equal(mergeMcpServer(f, 'mcpServers', 'linear', srv).action, 'already configured');

    // unparseable file is left untouched
    fs.writeFileSync(f, '{ not json ]');
    assert.match(mergeMcpServer(f, 'mcpServers', 'linear', srv).action, /^manual/);
    assert.equal(fs.readFileSync(f, 'utf8'), '{ not json ]');
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
