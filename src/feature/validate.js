import fs from 'node:fs';
import Ajv from 'ajv';
import { canonicalBody, canonicalJSON, hashBody, hashStructured } from './hash.js';
import { ContractError, pointer } from './errors.js';

const readSchema = name => JSON.parse(fs.readFileSync(new URL('../../schema/feature/' + name + '.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('date-time', value => {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!m) return false;
  const [, year, month, day, hour, minute, second, zoneHour = '0', zoneMinute = '0'] = m.map((v, i) => i ? Number(v) : v);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 && (Number.isNaN(zoneHour) || zoneHour <= 23) &&
    (Number.isNaN(zoneMinute) || zoneMinute <= 59);
});
ajv.addSchema(readSchema('common'));
const recordSchema = readSchema('record');
ajv.addSchema(recordSchema);
const validators = Object.fromEntries(Object.keys(recordSchema.definitions).map(kind =>
  [kind, ajv.compile({ $ref: 'feature-record-v1#/definitions/' + kind })]));

export function schemaDiagnostics(validator, value, root) {
  if (validator(value)) return [];
  return validator.errors.map(e => ({
    code: 'SCHEMA_INVALID',
    path: (root + e.instancePath + (e.keyword === 'required' ? '/' + pointer(e.params.missingProperty)
      : e.keyword === 'additionalProperties' ? '/' + pointer(e.params.additionalProperty) : '')) || '/',
    message: e.message,
  }));
}
export function validateRecord(record, references = []) {
  const diagnostics = [];
  const add = (code, path, message) => diagnostics.push({ code, path, message });
  const check = (r, path) => {
    try { canonicalJSON(r); } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      diagnostics.push(...e.diagnostics.map(d => ({ ...d, path: path + (d.path === '/' ? '' : d.path) })));
      return false;
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      add('SCHEMA_INVALID', path, 'Expected a typed feature record'); return false;
    }
    if (r.schemaVersion !== 1) {
      add('UNSUPPORTED_SCHEMA', path + '/schemaVersion', 'Use a matching Ticket-Flow version; supported feature schema: 1');
      return false;
    }
    if (typeof r.recordType !== 'string' || !Object.hasOwn(validators, r.recordType)) {
      add('UNSUPPORTED_RECORD', path + '/recordType', 'Unsupported record type; later domain contracts are not available');
      return false;
    }
    const errors = schemaDiagnostics(validators[r.recordType], r, path);
    diagnostics.push(...errors);
    if (errors.length) return false;
    if ('body' in r) {
      if (r.body !== canonicalBody(r.body)) add('NON_CANONICAL_BODY', path + '/body', 'Capture the LF-normalized body before creating a record');
      if (hashBody(r.body) !== r.bodyHash) add('BODY_HASH_MISMATCH', path + '/bodyHash', 'Body does not match its SHA-256');
    }
    if ('hash' in r && hashStructured(r) !== r.hash) add('RECORD_HASH_MISMATCH', path + '/hash', 'Record hash does not match its content');
    for (const [field, id] of [['questions', 'questionId'], ['findings', 'findingId']]) {
      const seen = new Set();
      for (const [i, item] of (r[field] || []).entries()) {
        if (seen.has(item[id])) add('DUPLICATE_ID', path + '/' + field + '/' + i + '/' + id, 'IDs must be unique within a record');
        seen.add(item[id]);
      }
    }
    return true;
  };
  const validShape = check(record, '/record');
  if (!Array.isArray(references)) {
    add('SCHEMA_INVALID', '/references', 'Expected an array of supplied revision snapshots');
  } else {
    const revisions = new Map();
    for (const [i, snapshot] of references.entries()) {
      if (!check(snapshot, '/references/' + i)) continue;
      if (snapshot.recordType !== 'revision') {
        add('REFERENCE_MISMATCH', '/references/' + i, 'Reference evidence must be a retained revision snapshot'); continue;
      }
      const key = JSON.stringify([snapshot.artifactId, snapshot.revisionId]);
      if (revisions.has(key)) add('REFERENCE_DUPLICATE', '/references/' + i, 'Repeated artifact/revision identity');
      revisions.set(key, snapshot);
    }
    if (validShape) {
      const refs = (record.sources || []).map((r, i) => [r, '/record/sources/' + i]);
      if (record.target) refs.push([record.target, '/record/target']);
      if (record.resultingRevision) refs.push([record.resultingRevision, '/record/resultingRevision']);
      for (const [ref, path] of refs) {
        const snapshot = revisions.get(JSON.stringify([ref.artifactId, ref.revisionId]));
        if (!snapshot) { add('REFERENCE_MISSING', path, 'Supply the exact referenced revision in references'); continue; }
        if (snapshot.featureId !== record.featureId) add('REFERENCE_MISMATCH', path + '/featureId', 'Referenced revision belongs to another feature');
        if (snapshot.bodyHash !== ref.bodyHash) add('REFERENCE_MISMATCH', path + '/bodyHash', 'Referenced hash differs from the retained revision');
        if (ref.snapshotRef && (!snapshot.storageRef || canonicalJSON(ref.snapshotRef) !== canonicalJSON(snapshot.storageRef))) {
          add('REFERENCE_MISMATCH', path + '/snapshotRef', 'Tracker reference differs from the supplied snapshot location');
        }
        if (record.recordType === 'approval' && !ref.snapshotRef) {
          add('REFERENCE_MISSING', path + '/snapshotRef', 'Approval must identify the retained tracker snapshot');
        }
      }
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}
export function assertRecord(record, references = []) {
  const result = validateRecord(record, references);
  if (!result.valid) throw new ContractError(result.diagnostics);
  return record;
}
