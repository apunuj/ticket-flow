import { hashBody } from '../../src/feature/hash.js';
export const featureId = '4e82b1db-c20e-4f55-9a14-6b0e25690001';
export const trackerRef = (id = 'snapshot-1') => ({
  backend: 'linear', workspaceId: 'workspace-1', parentId: 'parent-1',
  objectKind: 'document', objectId: id,
});
export function revision(body = 'Exact café 😀\n', revisionId = 'revision-1') {
  return { schemaVersion: 1, recordType: 'revision', recordId: 'record-' + revisionId,
    revisionId, featureId, createdAt: '2026-10-01T10:00:00Z',
    artifactId: 'prd-1', kind: 'prd', body, bodyHash: hashBody(body), sources: [],
    storageRef: trackerRef(revisionId) };
}
export const revisionRef = r => ({ artifactId: r.artifactId, revisionId: r.revisionId,
  bodyHash: r.bodyHash, snapshotRef: r.storageRef });
export function approval(snapshot = revision()) {
  return { schemaVersion: 1, recordType: 'approval', recordId: 'approval-1',
    revisionId: 'approval-revision-1', featureId, createdAt: '2026-10-01T10:01:00Z',
    target: revisionRef(snapshot),
    decision: { kind: 'approved', text: 'Yes, approved', reference: 'conversation:turn-4',
      actor: 'user', at: '2026-10-01T10:01:00Z', qualifications: [] } };
}
