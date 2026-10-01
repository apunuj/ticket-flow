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

const LARGE_IO = { maxBuffer: 64 * 1024 * 1024, timeout: 45000 };
const INPUT_BYTES = 16 * 1024 * 1024;
function assertUnpackLimit(result) {
  assert.equal(result.code, 2);
  const response = result.json();
  assert.equal(response.valid, false);
  assert.equal(Object.hasOwn(response, 'result'), false);
  assert.equal(response.diagnostics[0].code, 'UNPACK_INPUT_LIMIT');
  assert.equal(response.diagnostics[0].path, '/');
  assert.match(response.diagnostics[0].message, /16777216/);
}
test('packing rejects the reported escape-heavy record before emitting parts', { timeout: 60000 }, () => {
  const request = { schemaVersion: 1, record: revision('"'.repeat(2200000)) };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < INPUT_BYTES);
  const result = run('pack-record', request, undefined, LARGE_IO);
  assertUnpackLimit(result);
  assert.match(result.json().diagnostics[0].message, /at least/);
});
test('finalization rejects reference expansion after provisional preparation', { timeout: 60000 }, () => {
  const record = revision('small record');
  const prepared = run('pack-record', { schemaVersion: 1, record });
  assert.equal(prepared.code, 0);
  assert.equal(prepared.json().result.descriptor, null);
  assert.equal(prepared.json().result.parts.length, 1);
  const partRefs = [{ ...trackerRef('one'), url: 'https://example.test/' + 'a'.repeat(9 * 1024 * 1024) }];
  const request = { schemaVersion: 1, record, partRefs };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < INPUT_BYTES);
  assertUnpackLimit(run('pack-record', request, undefined, LARGE_IO));
  // Record validation still wins over the later transport-size check.
  const invalid = run('pack-record', { ...request, record: { ...record, bodyHash: '0'.repeat(64) } }, undefined, LARGE_IO);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.json().diagnostics[0].code, 'BODY_HASH_MISMATCH');
});
test('accepted escaped Unicode records and supplied evidence still round-trip', () => {
  const source = revision('source café 😀\n', 'source-1');
  const record = revision(('café 😀 "\\\\\n' + String.fromCharCode(96).repeat(7)).repeat(250));
  record.sources = [{ artifactId: source.artifactId, revisionId: source.revisionId, bodyHash: source.bodyHash, snapshotRef: source.storageRef }];
  const input = { schemaVersion: 1, record, references: [source], maxPartBytes: 750 };
  const prepared = run('pack-record', input);
  assert.equal(prepared.code, 0);
  const partRefs = prepared.json().result.parts.map(p => ({ ...trackerRef(p.partId), url: 'https://example.test/café/😀' }));
  const packed = run('pack-record', { ...input, partRefs });
  assert.equal(packed.code, 0);
  const result = packed.json().result;
  assert.deepEqual(result.parts, prepared.json().result.parts);
  assert.ok(result.parts.every(part => part.bytes <= 750));
  const parts = result.parts.map((p, i) => ({ ref: partRefs[i], text: p.text }));
  const unpacked = run('unpack-record', { schemaVersion: 1, descriptor: result.descriptor, parts, references: [source] });
  assert.equal(unpacked.code, 0);
  assert.deepEqual(unpacked.json().result.record, record);
});
test('unpack size guard accepts the exact UTF-8 boundary and counts supplied evidence', async () => {
  const { assertUnpackInputFits } = await import('../src/cli/feature-limits.js');
  const { packRecord } = await import('../src/feature/records.js');
  const record = revision('😀 "\\\n'.repeat(12));
  const prepared = packRecord({ record, maxPartBytes: 450 });
  const partRefs = prepared.parts.map(p => ({ ...trackerRef(p.partId), url: 'https://example.test/café/😀' }));
  const packed = packRecord({ record, maxPartBytes: 450, partRefs });
  for (const references of [undefined, [], [revision('supplied evidence 😀', 'evidence-1')]]) {
    const request = { schemaVersion: 1, descriptor: packed.descriptor,
      parts: packed.parts.map((part, i) => ({ ref: partRefs[i], text: part.text })) };
    if (references !== undefined) request.references = references;
    const json = JSON.stringify(request), bytes = Buffer.byteLength(json);
    assert.ok(bytes > json.length, 'fixture distinguishes UTF-8 bytes from JS string length');
    assert.equal(assertUnpackInputFits(packed, references, bytes), bytes);
    assert.throws(() => assertUnpackInputFits(packed, references, bytes - 1),
      error => error.diagnostics[0].code === 'UNPACK_INPUT_LIMIT');
    const lowerBound = assertUnpackInputFits(prepared, references, bytes);
    assert.ok(lowerBound < bytes, 'unknown tracker locations only permit a lower bound');
    assert.throws(() => assertUnpackInputFits(prepared, references, lowerBound - 1),
      error => error.diagnostics[0].code === 'UNPACK_INPUT_LIMIT' && /at least/.test(error.message));
  }
  const omitted = assertUnpackInputFits(prepared);
  assert.equal(assertUnpackInputFits(prepared, []) - omitted, Buffer.byteLength(',"references":[]'));
});
test('raw stdin retains the exact 16 MiB boundary and INPUT_LIMIT diagnostic', { timeout: 60000 }, () => {
  const json = JSON.stringify({ schemaVersion: 1, kind: 'body', value: 'café 😀' });
  const atLimit = json + ' '.repeat(INPUT_BYTES - Buffer.byteLength(json));
  const accepted = run('hash', atLimit, undefined, LARGE_IO);
  assert.equal(accepted.code, 0);
  assert.equal(accepted.json().result.canonicalBody, 'café 😀');
  const rejected = run('hash', atLimit + ' ', undefined, LARGE_IO);
  assert.equal(rejected.code, 2);
  assert.equal(rejected.json().diagnostics[0].code, 'INPUT_LIMIT');
});
