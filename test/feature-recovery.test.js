import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRecord, unpackRecord } from '../src/feature/records.js';
import { revision, trackerRef } from './fixtures/feature.js';

function retain(record, previousDescriptor) {
  const prior = previousDescriptor ? { previousDescriptor } : {};
  const prepared = packRecord({ record, maxPartBytes: 750, ...prior });
  const partRefs = prepared.parts.map(p => trackerRef(p.partId));
  return packRecord({ record, maxPartBytes: 750, partRefs, ...prior });
}
test('preparing a replacement rejects changed content under the same record/revision identity', () => {
  const oldRecord = revision('old text');
  const old = retain(oldRecord);
  const changed = { ...revision('new text'), recordId: oldRecord.recordId };
  assert.throws(() => retain(changed, old.descriptor), e =>
    e.diagnostics?.some(d => d.code === 'REVISION_REUSED'));
  assert.deepEqual(retain(oldRecord, old.descriptor), old, 'identical retries retain stable identities');
  const foreign = { ...old.descriptor, featureId: '4e82b1db-c20e-4f55-9a14-6b0e25690002' };
  assert.throws(() => retain(oldRecord, foreign), e =>
    e.diagnostics?.some(d => d.code === 'PREVIOUS_IDENTITY'));
});
test('interruption at every part/descriptor/pointer write preserves the old complete record', () => {
  const oldRecord = revision('old 😀 '.repeat(80));
  const old = retain(oldRecord);
  const newRecord = { ...revision('new content 😀 '.repeat(120), 'revision-2'), recordId: oldRecord.recordId };
  const next = retain(newRecord, old.descriptor);
  const oldBytes = JSON.stringify(old);
  // Each run models a fresh process reconstructing exclusively from tracker-held values.
  const events = [...next.parts.map((p, i) => ['part', next.descriptor.parts[i].ref, p.text]),
    ['descriptor', next.descriptor], ['pointer', next.descriptor.revisionId]];
  for (let stop = 0; stop <= events.length; stop++) {
    const store = new Map(old.parts.map((p, i) => [old.descriptor.parts[i].ref.objectId, p.text]));
    const descriptors = new Map([[oldRecord.revisionId, structuredClone(old.descriptor)]]);
    let pointer = oldRecord.revisionId;
    for (const event of events.slice(0, stop)) {
      if (event[0] === 'part') store.set(event[1].objectId, event[2]);
      if (event[0] === 'descriptor') {
        // Read-back of all parts precedes publishing the descriptor.
        const parts = event[1].parts.map(p => ({ ref: p.ref, text: store.get(p.ref.objectId) }));
        assert.deepEqual(unpackRecord({ descriptor: event[1], parts }), newRecord);
        descriptors.set(newRecord.revisionId, event[1]);
      }
      if (event[0] === 'pointer') pointer = event[1];
    }
    const read = descriptor => unpackRecord({ descriptor,
      parts: descriptor.parts.map(p => ({ ref: p.ref, text: store.get(p.ref.objectId) })) });
    assert.deepEqual(read(old.descriptor), oldRecord, 'old revision survives every interruption');
    assert.deepEqual(read(descriptors.get(pointer)), stop === events.length ? newRecord : oldRecord);
    assert.equal(JSON.stringify(old), oldBytes, 'preparation never mutates prior objects');
    const missing = next.descriptor.parts.filter(p => !store.has(p.ref.objectId));
    if (missing.length) assert.throws(() => read(next.descriptor));
  }
});
