# Feature record contract v1

These are the portable, stateless foundation helpers introduced by APU-1102.
They run on Ticket-Flow's Node 18+ runtime. They read the package's schemas but
never contact a tracker, read credentials, or persist feature/recovery state.
The tracker remains the authoritative store. Temporary request files are disposable.

## Invocation and results

Use the same package version that generated the workflow pack. Generated guidance
pins the actual package version. For a locally checked-out, unreleased build:

```sh
node bin/cli.js feature hash --input - <<'JSON'
{"schemaVersion":1,"kind":"body","value":"hello\r\n"}
JSON
```

After the matching package version is published, use the version-pinned command
shown in the generated guide. A non-Node consumer needs Node/npm, but no package
manifest, lockfile, or local dependency installation. Never fall back to a prior
package version that lacks these helpers.

All commands take exactly `--input -`, read one UTF-8 JSON value (maximum 16 MiB),
and emit one JSON result on stdout. `feature --help` prints ordinary usage text.
Other flags, file arguments, commands, unknown fields, and schema versions fail
explicitly. Do not send secrets in request payloads.

The CLI also checks whether a packed record's compact unpack request fits within
16 MiB. An oversized pack returns exit 2 with `UNPACK_INPUT_LIMIT` at `/` and no
result, parts, or descriptor. Its message reports the encoded byte count and limit;
a preparation estimate is labelled "at least". Raw stdin over the cap continues
to return `INPUT_LIMIT`. These are CLI transport limits; the core codec is unchanged.

```json
{"schemaVersion":1,"command":"hash","valid":true,"result":{"hash":"...","canonicalBody":"hello\n"},"diagnostics":[]}
```

- Exit **0**: supplied record/input is valid.
- Exit **2**: malformed input, unsupported capability/schema, or invalid evidence.
- Exit **1**: unexpected execution failure, such as an input I/O error.

Failure results have `valid:false`, no `result`, and diagnostics containing stable
`code`, JSON Pointer `path`, and `message`. `/` denotes the whole input.
Passing validation is not proof of current tracker state, user consent, readiness
to execute, or a successful remote write. The `gate` command is unavailable.

## Requests

Every CLI request includes `schemaVersion:1`. See `helper.schema.json` for
request/response shapes; the JavaScript helpers accept the same fields without
this request-envelope version.

| Command | Additional request fields | Result |
| --- | --- | --- |
| hash | `kind:"body"`, `value:string` | `hash`, `canonicalBody` |
| hash | `kind:"structured"`, `value:JSON` | `hash` |
| validate | `record`, optional `references:[]` | Record identity and structured hash |
| pack-record | `record`, optional `references`, `maxPartBytes`, `partRefs`, `previousDescriptor` | `parts`, `draftDescriptor`, nullable `descriptor` |
| unpack-record | `descriptor`, `parts:[{ref,text}]`, optional `references` | Exact validated `record` |

## Records and references

The common implemented record kinds are `artifact`, `revision`, `approval`,
`checkpoint`, and `review`. Each requires `schemaVersion`, `recordType`,
`recordId`, `revisionId`, `featureId` (UUID), and `createdAt` (ISO timestamp).
Optional common fields are `createdBy`, `storageRef`, and the record's own `hash`.
Unknown types/versions and fields are rejected; later slices extend the schemas
with manifest, proposal, batch, binding, and other domain rules.

Artifact/revision records also require `artifactId`, `kind:prd|spec|slices`,
`body`, `bodyHash`, and `sources:[]`. An example retained revision is:

```json
{
  "schemaVersion": 1,
  "recordType": "revision",
  "recordId": "snapshot-1",
  "revisionId": "revision-1",
  "featureId": "4e82b1db-c20e-4f55-9a14-6b0e25690001",
  "createdAt": "2026-10-01T10:00:00Z",
  "artifactId": "prd-1",
  "kind": "prd",
  "body": "hello",
  "bodyHash": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  "sources": []
}
```

A revision reference names `artifactId`, `revisionId`, `bodyHash`, and optional
`snapshotRef`. Supply each directly referenced snapshot in `references`;
missing, duplicate, cross-feature, changed-hash, and mismatched-location evidence
is invalid. Referenced evidence must be a `revision`, not a mutable artifact.
This checks the supplied record's direct references and the snapshots' shapes and
hashes; it does not load or certify the entire transitive source chain.

A tracker reference requires `backend:linear|jira`, `workspaceId`, `parentId`,
`objectKind:document|comment|issue|milestone`, and `objectId`; `url` is optional.
An approval's target requires a `snapshotRef` matching the snapshot's
`storageRef`. Its decision separately records `kind:approved`, the user's
`text`, evidence `reference`, `actor`, `at`, and `qualifications:[]`.
A review's readiness never creates an approval. Checkpoint question IDs and
review finding IDs are unique within their records. Full shapes live in
`record.schema.json`.

## Canonical content and hashing

Capture the body returned by the adapter after read-back, normalize CRLF and
bare CR to LF, and hash its UTF-8 bytes with SHA-256. Keep all other whitespace,
punctuation, links, and Unicode unchanged. Records must already contain that
canonical body and matching digest; validators and codecs reject rather than
repair noncanonical records.

Structured hashing sorts object keys recursively in JavaScript lexical order,
including numeric-looking keys, and preserves array order. Primitive encoding
uses JSON serialization (`-0` becomes `0`). Only the root `hash` field is
excluded. Arrays, booleans, null, strings, and finite numbers are supported;
cycles, sparse arrays, accessors, non-JSON values, excessive nesting (>256), and
unpaired Unicode surrogates are rejected. No Unicode composition normalization
occurs. Descriptors hash the complete canonical serialized record, including its
optional root `hash`; this transport digest differs from a structured record hash.

## Packing, retention, and exact decoding

1. Call `pack-record` with a validated record. It produces immutable part texts
   and a draft descriptor; `descriptor` is null until storage references exist.
   Preparation rejects a request whose unpack envelope cannot fit even with minimum
   reference metadata. Success is provisional until actual tracker references exist.
2. Write each text to its own tracker object. Persist/reconcile these writes using
   their stable record/revision/part identities. Read each object back exactly.
3. Call `pack-record` with the same record and budget plus `partRefs` in part-index
   order. All references must identify distinct tracker objects. The resulting
   descriptor binds those exact locations. Finalization checks the exact unpack
   request size, including both copies of each tracker reference and supplied
   revision evidence. Large real references can therefore make finalization fail
   after preparation succeeded. Supplied references alone are not write
   receipts and the helper does not claim remote durability.
4. Call `unpack-record` on that descriptor and the actual fetched `{ref,text}`
   objects. Verify the returned record before writing/read-verifying the descriptor
   and advancing the tracker-held current pointer.

Use compact UTF-8 JSON, as produced by `JSON.stringify(request)`, for unpack input.
The check counts the full descriptor, escaped `{ref,text}` entries, and the same
optional `references` array supplied while packing; omit it if it was omitted then.
Extra formatting, a trailing newline, or optional Unicode escapes can exceed the
raw input limit near the boundary. Preserve the exact decoded part text and refs.

If finalization fails, keep the previous complete descriptor and current pointer.
Do not publish a descriptor or advance the pointer for the rejected replacement.
Already written provisional parts remain unpublished and can be reconciled by the
caller; the helper performs no tracker writes or cleanup.

Each part has record/revision IDs, a zero-based index, count, chunk hash, payload,
and a deterministic content-derived part ID. Chunks split canonical JSON only at
Unicode code-point boundaries. Size includes the complete escaped JSON wrapper,
visible `Ticket Flow record v1` marker, and fences longer than any backtick run.
Default budget is **12 KiB**, an internal target rather than a provider limit;
adapters may require smaller budgets and must account for native rich-text overhead.

Unpacking accepts fetched parts in any order, but the descriptor must list every
index in order. It rejects missing/repeated/unexpected parts, mixed identities or
revisions, malformed/noncanonical wrappers, invalid references, chunk/aggregate
hash mismatches, and invalid reconstructed records. Adapter code must reconstruct
the exact wrapper string from native code blocks; models must not repair or retype
payloads to make their hashes pass.

For an update, use a new `revisionId`, write a new part set and descriptor, and
advance the current pointer only after verification. Keep old parts immutable.
Optional `previousDescriptor` guards a known record's identity and rejects changed
content under its previous revision ID. Without prior evidence, a stateless helper
cannot discover prior ID reuse. Different budgets can change segmentation; retain
the original budget for retries and never overwrite already referenced parts.

The interruption fixtures simulate every part/descriptor/pointer write and prove
the previous complete revision remains readable. They do not establish live host
or tracker compatibility. There is no distributed transaction, lock, or exactly-once
write guarantee; one mutating run per feature and optimistic read-back checks remain
caller responsibilities.
