import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord } from '../src/feature/validate.js';
import { hashBody, hashStructured } from '../src/feature/hash.js';
import { revision, revisionRef, approval, trackerRef } from './fixtures/feature.js';

const fails = (record, code, path, references = []) => {
  const result = validateRecord(record, references);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(d => d.code === code && d.path === path), JSON.stringify(result));
};
test('revision and artifact contracts validate without mutating input', () => {
  for (const recordType of ['revision', 'artifact']) {
    const r = { ...revision(), recordType };
    const before = JSON.stringify(r);
    assert.deepEqual(validateRecord(r), { valid: true, diagnostics: [] });
    assert.equal(JSON.stringify(r), before);
  }
  const r = revision(); r.hash = hashStructured(r);
  assert.equal(validateRecord(r).valid, true);
  r.body = 'changed';
  fails(r, 'BODY_HASH_MISMATCH', '/record/bodyHash');
  r.bodyHash = hashBody(r.body);
  fails(r, 'RECORD_HASH_MISMATCH', '/record/hash');
});
test('unsupported versions/types, malformed fields and references include evidence paths', () => {
  fails({ ...revision(), schemaVersion: 2 }, 'UNSUPPORTED_SCHEMA', '/record/schemaVersion');
  fails({ ...revision(), recordType: 'slices' }, 'UNSUPPORTED_RECORD', '/record/recordType');
  const r = revision(); delete r.featureId;
  fails(r, 'SCHEMA_INVALID', '/record/featureId');
  fails({ ...revision(), featureId: 'not-uuid' }, 'SCHEMA_INVALID', '/record/featureId');
  fails({ ...revision(), storageRef: { ...trackerRef(), objectId: '' } }, 'SCHEMA_INVALID', '/record/storageRef/objectId');
  fails({ ...revision(), extra: true }, 'SCHEMA_INVALID', '/record/extra');
  fails({ ...revision(), createdAt: 'yesterday' }, 'SCHEMA_INVALID', '/record/createdAt');
});
test('approval binds the exact supplied snapshot, feature, hash, and tracker reference', () => {
  const snapshot = revision(), a = approval(snapshot);
  assert.equal(validateRecord(a, [snapshot]).valid, true);
  fails(a, 'REFERENCE_MISSING', '/record/target');
  const changed = { ...a, target: { ...a.target, bodyHash: '0'.repeat(64) } };
  fails(changed, 'REFERENCE_MISMATCH', '/record/target/bodyHash', [snapshot]);
  const foreign = { ...snapshot, featureId: '4e82b1db-c20e-4f55-9a14-6b0e25690002' };
  fails(a, 'REFERENCE_MISMATCH', '/record/target/featureId', [foreign]);
  const moved = { ...snapshot, storageRef: trackerRef('elsewhere') };
  fails(a, 'REFERENCE_MISMATCH', '/record/target/snapshotRef', [moved]);
  fails(a, 'REFERENCE_DUPLICATE', '/references/1', [snapshot, snapshot]);
  fails({ ...a, decision: { ...a.decision, kind: 'ready' } }, 'SCHEMA_INVALID', '/record/decision/kind', [snapshot]);
});
test('source references, checkpoints and reviews use common exact revision contracts', () => {
  const snapshot = revision(), ref = revisionRef(snapshot);
  const based = { ...revision('design', 'spec-v1'), artifactId: 'spec-1', kind: 'spec', sources: [ref] };
  assert.equal(validateRecord(based, [snapshot]).valid, true);
  fails(based, 'REFERENCE_MISSING', '/record/sources/0');
  const common = { schemaVersion: 1, recordId: 'event-1', revisionId: 'event-v1',
    featureId: snapshot.featureId, createdAt: snapshot.createdAt };
  const checkpoint = { ...common, recordType: 'checkpoint',
    questions: [{ questionId: 'Q1', prompt: 'Which user?', answer: 'Operators' }],
    productDecisions: [], technicalDecisions: [], assumptions: [], unresolvedItems: [],
    nextFocus: 'Review draft', resultingRevision: ref };
  assert.equal(validateRecord(checkpoint, [snapshot]).valid, true);
  fails({ ...checkpoint, questions: [...checkpoint.questions, ...checkpoint.questions] },
    'DUPLICATE_ID', '/record/questions/1/questionId', [snapshot]);
  const review = { ...common, recordType: 'review', target: ref, baselineEvidence: ['repo:9134cbf'],
    findings: [{ findingId: 'F1', description: 'Clarify audience', disposition: 'addressed' }],
    resultingRevision: ref, readiness: 'ready', unresolvedDecisions: [] };
  assert.equal(validateRecord(review, [snapshot]).valid, true);
  assert.equal('decision' in review, false);
});
test('canonical bodies and malformed reference evidence are rejected, not repaired', () => {
  fails(revision('a\r\nb'), 'NON_CANONICAL_BODY', '/record/body');
  fails(null, 'SCHEMA_INVALID', '/record');
  fails(approval(), 'BODY_HASH_MISMATCH', '/references/0/bodyHash', [{ ...revision(), body: 'tampered' }]);
  fails(revision(), 'SCHEMA_INVALID', '/references', {});
});

test('malformed record discriminators and impossible dates are validation failures', () => {
  fails({ ...revision(), recordType: { toString: 'not callable' } }, 'UNSUPPORTED_RECORD', '/record/recordType');
  fails({ ...revision(), createdAt: '2026-02-30T10:00:00Z' }, 'SCHEMA_INVALID', '/record/createdAt');
});
