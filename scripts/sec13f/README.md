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
