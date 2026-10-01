import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { revision, trackerRef } from './fixtures/feature.js';
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function run(command, input, args = ['--input', '-'], options = {}) {
  const p = spawnSync(process.execPath, [CLI, 'feature', command, ...args], {
    encoding: 'utf8', input: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input),
    ...options,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr, json: () => JSON.parse(p.stdout) };
}
test('four helpers accept typed stdin and emit one structured result without config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-feature-cli-'));
  try {
    const request = { schemaVersion: 1, kind: 'body', value: 'hello\r\n' };
    const hash = run('hash', request, undefined, { cwd });
    assert.equal(hash.code, 0, hash.stderr);
    assert.equal(hash.stderr, '');
    assert.equal(hash.json().result.canonicalBody, 'hello\n');
    assert.equal(hash.json().result.hash.length, 64);
    const record = revision('😀\n'.repeat(1000));
    const prepare = run('pack-record', { schemaVersion: 1, record, maxPartBytes: 750 }, undefined, { cwd });
    assert.equal(prepare.code, 0, prepare.stdout);
    const partRefs = prepare.json().result.parts.map(p => trackerRef(p.partId));
    const packed = run('pack-record', { schemaVersion: 1, record, maxPartBytes: 750, partRefs }).json().result;
    const parts = packed.parts.map((p, i) => ({ ref: partRefs[i], text: p.text }));
    const decoded = run('unpack-record', { schemaVersion: 1, descriptor: packed.descriptor, parts });
    assert.equal(decoded.code, 0, decoded.stdout);
    assert.deepEqual(decoded.json().result.record, record);
    const valid = run('validate', { schemaVersion: 1, record });
    assert.equal(valid.code, 0, valid.stdout);
    assert.equal(valid.json().valid, true);
    assert.deepEqual(fs.readdirSync(cwd), [], 'helpers create no local manifest or recovery state');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
test('bad JSON, invalid UTF-8, unsupported versions and records exit 2 with paths', () => {
  for (const input of ['', '{', 'null', Buffer.from([0xff]), { schemaVersion: 2, record: revision() },
    { schemaVersion: 1, record: { ...revision(), schemaVersion: 9 } },
    { schemaVersion: 1, record: { ...revision(), recordType: 'manifest' } },
    { schemaVersion: 1, record: { ...revision(), bodyHash: '0'.repeat(64) } }]) {
    const p = run('validate', input);
    assert.equal(p.code, 2, p.stdout + p.stderr);
    assert.equal(p.json().valid, false);
    assert.ok(p.json().diagnostics.every(d => d.path.startsWith('/') && d.code && d.message));
    assert.equal(p.stderr, '');
  }
});
test('strict feature arguments never fall through to a legacy command or action gate', () => {
  for (const [cmd, args] of [
    ['gate', ['--input', '-']], ['hash', []], ['hash', ['--input', 'file.json']],
    ['hash', ['--input', '-', '--out', 'file']], ['validate', ['--input', '-', '--help']],
  ]) {
    const p = run(cmd, {}, args);
    assert.equal(p.code, 2, p.stdout);
    assert.equal(p.json().valid, false);
  }
  const wrong = run('hash', { schemaVersion: 1, kind: 'body', value: 'ok', extra: true });
  assert.equal(wrong.code, 2);
  const finite = run('hash', '{"schemaVersion":1,"kind":"structured","value":{"n":1e999}}');
  assert.equal(finite.code, 2);
  const structured = run('hash', { schemaVersion: 1, kind: 'structured', value: { b: 2, a: 1 } });
  assert.equal(structured.code, 0);
});
test('unexpected input execution failure exits 1 with structured diagnostics', async () => {
  const { runFeature } = await import('../src/cli/feature.js');
  let output = '';
  const code = await runFeature(['hash', '--input', '-'], {
    readInput: async () => { throw new Error('fixture I/O failure'); },
    writeOutput: text => { output += text; },
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(output).diagnostics[0].code, 'EXECUTION_FAILED');
});
