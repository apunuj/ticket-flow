import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRecord, unpackRecord, encodePart, decodePart } from '../src/feature/records.js';
import { canonicalJSON, sha256 } from '../src/feature/hash.js';
import { revision, trackerRef, approval } from './fixtures/feature.js';

function stored(record = revision(), maxPartBytes = 1024) {
  const prepared = packRecord({ record, maxPartBytes });
  const partRefs = prepared.parts.map(p => trackerRef(p.partId));
  const packed = packRecord({ record, maxPartBytes, partRefs });
  return { ...packed, fetched: packed.parts.map((p, i) => ({ ref: partRefs[i], text: p.text })) };
}
const expectCode = (fn, code) => assert.throws(fn, e => e.diagnostics?.some(d => d.code === code && d.path.startsWith('/')));
test('pack/unpack preserves long Unicode/Markdown, measures full wrapper and binds exact refs', () => {
  const body = '😀 café e\u0301\t"\\\\\n[link](https://example.com)\n' + String.fromCharCode(96).repeat(13) + '\n';
  const record = revision(body.repeat(800));
  const before = structuredClone(record);
  const packed = stored(record, 750);
  assert.ok(packed.parts.length > 99, 'exercise multiple count/index digit boundaries');
  for (const part of packed.parts) {
    assert.equal(part.bytes, Buffer.byteLength(part.text, 'utf8'));
    assert.ok(part.bytes <= 750);
    const decoded = decodePart(part.text);
    assert.ok(!/[\ud800-\udbff]$/.test(decoded.payload));
    const fence = part.text.split('\n')[1].replace(/json$/, '');
    const runs = canonicalJSON(decoded).match(/\x60+/g) || [];
    assert.ok(runs.every(run => run.length < fence.length));
  }
  assert.deepEqual(unpackRecord({ descriptor: packed.descriptor, parts: packed.fetched.slice().reverse() }), record);
  assert.deepEqual(record, before);
});
test('preparation has no published descriptor until exact tracker references are supplied', () => {
  const record = revision();
  const prepared = packRecord({ record });
  assert.equal(prepared.descriptor, null);
  assert.equal(prepared.draftDescriptor.parts.length, prepared.parts.length);
  const again = packRecord({ record });
  assert.deepEqual(again, prepared);
  expectCode(() => unpackRecord({ descriptor: prepared.draftDescriptor, parts: [] }), 'SCHEMA_INVALID');
  expectCode(() => packRecord({ record, partRefs: [] }), 'REFERENCE_COUNT');
  const long = revision('long '.repeat(1000));
  const p = packRecord({ record: long, maxPartBytes: 750 });
  expectCode(() => packRecord({ record: long, maxPartBytes: 750, partRefs: p.parts.map(() => trackerRef()) }), 'REFERENCE_DUPLICATE');
  expectCode(() => packRecord({ record, maxPartBytes: 1 }), 'PART_BUDGET');
});
test('missing, repeated, unexpected and foreign-reference parts are rejected', () => {
  const packed = stored(revision('hello '.repeat(500)), 750);
  const run = parts => unpackRecord({ descriptor: packed.descriptor, parts });
  expectCode(() => run(packed.fetched.slice(1)), 'PART_SET_INVALID');
  const dup = structuredClone(packed.fetched); dup[1] = dup[0];
  expectCode(() => run(dup), 'PART_DUPLICATE');
  expectCode(() => run([...packed.fetched, packed.fetched[0]]), 'PART_SET_INVALID');
  const foreign = structuredClone(packed.fetched); foreign[0].ref.objectId = 'unknown';
  expectCode(() => run(foreign), 'PART_UNEXPECTED');
});
test('mixed revision, index/count/identity corruption and chunk hashes are rejected', () => {
  const packed = stored(revision('value '.repeat(100)), 750);
  for (const [field, value, code] of [
    ['revisionId', 'other', 'PART_IDENTITY'], ['recordId', 'other', 'PART_IDENTITY'],
    ['index', 99, 'PART_IDENTITY'], ['count', 999, 'PART_IDENTITY'],
    ['partId', 'other', 'PART_IDENTITY'], ['payload', 'corrupt', 'PART_HASH_MISMATCH'],
    ['hash', '0'.repeat(64), 'PART_HASH_MISMATCH'],
  ]) {
    const parts = structuredClone(packed.fetched);
    parts[0].text = encodePart({ ...decodePart(parts[0].text), [field]: value });
    expectCode(() => unpackRecord({ descriptor: packed.descriptor, parts }), code);
  }
});
test('descriptor order/hash/schema and reconstructed record are strictly validated', () => {
  const packed = stored(revision('payload '.repeat(100)), 750);
  const descriptor = structuredClone(packed.descriptor);
  descriptor.hash = '0'.repeat(64);
  expectCode(() => unpackRecord({ descriptor, parts: packed.fetched }), 'RECORD_HASH_MISMATCH');
  descriptor.schemaVersion = 2;
  expectCode(() => unpackRecord({ descriptor, parts: packed.fetched }), 'SCHEMA_INVALID');
  const reordered = structuredClone(packed.descriptor); reordered.parts.reverse();
  expectCode(() => unpackRecord({ descriptor: reordered, parts: packed.fetched }), 'DESCRIPTOR_ORDER');
  const incomplete = structuredClone(packed.descriptor); incomplete.parts.pop();
  expectCode(() => unpackRecord({ descriptor: incomplete, parts: packed.fetched }), 'PART_SET_INVALID');
  expectCode(() => decodePart(packed.parts[0].text + 'unexpected'), 'MALFORMED_PART');
  const decoded = decodePart(packed.parts[0].text);
  expectCode(() => decodePart(encodePart(decoded).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), 'MALFORMED_PART');
});
test('aggregate hash does not substitute for validation of the decoded record', () => {
  const packed = stored(revision());
  const part = decodePart(packed.fetched[0].text);
  const invalidRecord = { ...revision(), schemaVersion: 9 };
  part.payload = canonicalJSON(invalidRecord); part.hash = sha256(part.payload);
  part.partId = sha256(canonicalJSON([part.recordId, part.revisionId, part.index, part.hash]));
  const descriptor = structuredClone(packed.descriptor);
  descriptor.hash = sha256(part.payload);
  Object.assign(descriptor.parts[0], { hash: part.hash, partId: part.partId });
  expectCode(() => unpackRecord({ descriptor, parts: [{ ref: descriptor.parts[0].ref, text: encodePart(part) }] }), 'UNSUPPORTED_SCHEMA');
});
test('approval round trips only with matching supplied snapshot evidence', () => {
  const snapshot = revision(), record = approval(snapshot);
  const prepared = packRecord({ record, references: [snapshot] });
  const partRefs = prepared.parts.map(p => trackerRef(p.partId));
  const packed = packRecord({ record, references: [snapshot], partRefs });
  const parts = packed.parts.map((p, i) => ({ ref: partRefs[i], text: p.text }));
  assert.deepEqual(unpackRecord({ descriptor: packed.descriptor, parts, references: [snapshot] }), record);
  expectCode(() => unpackRecord({ descriptor: packed.descriptor, parts }), 'REFERENCE_MISSING');
});

test('malformed codec root values always include an evidence path', () => {
  for (const fn of [() => packRecord(null), () => unpackRecord(null)]) {
    assert.throws(fn, e => e.diagnostics?.every(d => d.path.startsWith('/')));
  }
});
