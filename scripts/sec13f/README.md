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
