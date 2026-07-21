# SEC 13F absorption contract

Slice 0 freezes the current CCH converter boundary before any acquisition port.
It does not fetch SEC data, write canonical/public payloads, change lane ownership,
or add a workflow.

Frozen artifacts:

- `config/investors.yaml`: exact 60-investor ID/CIK/name/group registry.
- `tests/sec13f/fixtures/cch_source_manifest.json`: digest-pinned CCH runtime
  source and mutable mapping inputs.
- `tests/sec13f/fixtures/cch_cache_manifest.json`: digest-only inventory of the
  local submissions/reference/tracker cache. Historical cover/information-table
  XML was not retained by CCH, so its raw-XML provenance remains `[not verified]`.
- `tests/sec13f/fixtures/cch_output_manifest.json`: the actual local CCH
  73-runtime-output byte baseline, including gitignored investor outputs.
- `tests/sec13f/fixtures/base_output_manifest.json`: current 73-output base
  boundary (3 indexes + 60 investors + 10 converter analytics).
- `tests/sec13f/fixtures/platform_derived_manifest.json`: the five platform
  derivatives kept outside the base boundary.
- `tests/sec13f/fixtures/sec_filing_cases.json`: nine synthetic, sanitized SEC
  filing/amendment failure and composition cases plus deterministic semantics.
- `tests/sec13f/fixtures/cch_platform_baseline.json`: path-aligned raw-byte
  comparison between the CCH outputs and current platform base outputs.

Refresh is explicit and requires the local CCH source path:

```bash
python3 -m pip install -r scripts/sec13f/requirements-contract.txt
python3 scripts/sec13f/freeze_slice0_contract.py \
  --cch-root ../claude-code-hub/docs/products/converters/sec-13f
python3 tests/sec13f/test_slice0_contract.py
```

The path is an operator input only. Committed artifacts contain portable source
repository/path metadata and digests, never an absolute local path.

The validators also pin each frozen artifact digest in `contract.py`. A refresh
that changes any source, cache, fixture, path, or output must fail until the new
artifact and its pin are reviewed and updated together.

## Slice A shadow boundary

Slice A adds a bounded, injectable SEC client, recent/history-shard discovery,
archive component retrieval, safe cover/information-table parsing, deterministic
amendment composition, explicit value normalization, and exact 73-output parity.
It does not own a workflow, lane registration, canonical/public generation, or
publication.

The live SEC path requires an explicitly configured real contact identity and is
not run by the fixture suite. A parity report is printed by default; file output
is restricted to the private control-plane path
`data/admin/sec-13f-shadow-parity.json`:

```bash
python3 scripts/sec13f/shadow.py \
  --cch-root /explicit/path/to/cch/output \
  --platform-root data/sec-13f

python3 tests/sec13f/test_slice_a_client.py
python3 tests/sec13f/test_slice_a_parser.py
python3 tests/sec13f/test_slice_a_normalization.py
python3 tests/sec13f/test_slice_a_parity.py
python3 tests/sec13f/test_slice_a_shadow.py
```

An explicitly dispatched live sample must supply its compared accession numbers
with repeated `--accession` arguments. No live request or shadow-report write is
performed by the tests.

The hermetic closure gate rebuilds four quarters for all 60 registry investors
through the in-memory SEC transport, proves the nine declared fixture outcomes,
and compares the independently generated 73 payloads with a detached CCH oracle.
The frozen input includes 480 parsed accessions and one below-threshold position
per investor to prove that pre-filter AUM and counts survive generation.

Normal tests never import sibling CCH code. Oracle refresh is a manual operation
that validates the pinned CCH source manifest, injects the fixed fixture timestamp,
normalizes only the declared sector-investor set ordering, and refuses any output
or manifest path overlapping canonical/public data:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sec13f/freeze_slice_a_oracle.py \
  --cch-root ../claude-code-hub/docs/products/converters/sec-13f \
  --input tests/sec13f/fixtures/generator_input.json \
  --output /explicit/empty/oracle-dir \
  --manifest /explicit/oracle-manifest.json

PYTHONDONTWRITEBYTECODE=1 python3 tests/sec13f/test_slice_a_end_to_end.py
```

## Slice B acquisition and recovery boundary

Slice B keeps ownership and publication unchanged while hardening the private
acquisition path. Live callers must use `SecClient.production(...)`, whose
default rate gate is shared across production clients; fixtures use the
explicit `SecClient.fixture(...)` constructor. Timeout, 429, and selected 5xx
responses retry with bounded backoff, while 401/403 stop immediately.

`RawCache` stores immutable CIK/accession document sets with per-document
digests. `CachedFilingSource` validates the cache before every read and permits
offline resume only from an explicitly retained discovery list. Corrupt cache
content never falls back to the network silently.

`IncrementalLedger` publishes only to its private immutable run root. The
transaction is acquisition/cache -> prepared input -> fresh staging output ->
73-file manifest verification -> immutable run manifest -> one atomic
`state.json` swap containing both current and LKG. Attempts and failpoint
candidates are separate from the active pointer, so failures and abandoned
runs cannot advance completion. An identical verified source set is replayed
without regenerating or rewriting active bytes.

This slice does not add a workflow, register a live lane, write canonical
`data/sec-13f`, or change the public mirror. All tests are hermetic:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  tests.sec13f.test_slice_b_client_faults \
  tests.sec13f.test_slice_b_cache \
  tests.sec13f.test_slice_b_source \
  tests.sec13f.test_slice_b_ledger
```

## Slice C0 local production input boundary

`prepare_local_input.py` turns an explicit, fully local filing manifest into
generator-safe investor input for the later Slice C backfill. It never creates
a SEC client or falls back to the network: every XML component is read through
the digest-validated `RawCache`, and every CUSIP resolution and unit decision
is supplied as a versioned input.

The manifest is `sec13f-local-input/v1` and contains the exact registry digest,
all 60 investors' filings, and one `dollars` or `thousands` decision for every
`(CIK, accession)`. The separate reference JSON maps each required CUSIP to a
non-empty `ticker` and `sector`. Both input file bytes are recorded in the
prepared artifact alongside the raw-cache source-set digest.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sec13f/prepare_local_input.py \
  --manifest /explicit/sec13f-local-input.json \
  --registry scripts/sec13f/config/investors.yaml \
  --reference-mapping /explicit/cusip-reference.json \
  --cache-root /explicit/private-sec13f-raw-cache \
  --output /explicit/private-sec13f-prepared-input.json
```

The output must be an explicit noncanonical path; canonical/public SEC 13F
trees and the immutable raw-cache root are rejected. Requested output paths
containing symlink components or parent traversal are rejected, as are existing
non-regular outputs. Replacing an existing regular prepared artifact additionally
requires `--overwrite`. This command prepares
input only: it does not run the 60-investor backfill, generate the 73 payloads,
advance the ledger, or publish any data.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  tests.sec13f.test_slice_c0_local_input
```
