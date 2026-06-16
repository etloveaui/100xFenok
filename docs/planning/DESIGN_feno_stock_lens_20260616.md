# Feno Stock Lens Design Contract

Date: 2026-06-16
Status: draft contract for development work

## Product Language Rule

User-facing output must speak in Feno product language, not source-brand
language.

- Do not use source/vendor names as product section titles, card labels, badges,
  or primary explanations.
- Allowed product language examples:
  - `기업 실적`
  - `밸류에이션`
  - `가격·배당 히스토리`
  - `기관 공시`
  - `수익성 추이`
  - `Feno 자동 해석`
- Source/vendor names are allowed only in internal provenance, admin/debug views,
  developer docs, data manifests, and audit logs.
- Public UI may expose provenance only behind an explicit technical detail affordance
  such as `데이터 출처 자세히`, never as the primary product framing.

## Data Use Rule

All available fields should be inventoried before deciding what is important.
The default path is not "omit"; it is:

1. inventory
2. classify
3. expose in raw/pro view or use in interpretation
4. hide only with a documented reason

Every field should be assigned one of:

- `interpreted`: consumed by deterministic or LLM-assisted interpretation
- `visually_rendered`: rendered directly in UI tables, cards, charts, or text surfaces
- `metadata`: structural/provenance fields used for identity, grouping, freshness, or traceability
- `not_yet_used`: inventoried but awaiting UX or interpretation mapping
- `deprecated_with_reason`: intentionally excluded with rationale

Implemented inventory:

- Generator: `node scripts/generate-stock-field-usage-manifest.mjs`
- Internal manifest: `data/admin/stock-field-usage-manifest.json`
- Public mirror: `100xfenok-next/public/data/admin/stock-field-usage-manifest.json`
- Current scan: 2,744 parsed files, 883 schema-level fields, 490KB manifest
- Current status split: `not_yet_used` 520, `visually_rendered` 219,
  `metadata` 143, `interpreted` 1
- Dynamic maps such as ticker/date/investor keyed objects are normalized to `*`
  so the manifest remains schema-level, not per-symbol/per-date noise.
- Source/vendor names may appear only in `internalSource` or developer/admin
  context. User-facing labels must use `productLabel` or Feno/function language.

Admin audit UI:

- Route: `/admin/data-lab`
- Static embed: `admin/data-lab/index.html` and
  `100xfenok-next/public/admin/data-lab/index.html`
- The stock field audit renders summary cards first, then paginated status and
  dataset filters.
- `not_yet_used` fields are not dumped into the DOM by default; they render only
  when the backlog status filter is selected.
- `internalSource` paths are hidden by default and appear only behind the admin
  Debug toggle.

## Architecture Direction

- `stock_lens_full`: per-symbol full profile for professional depth.
- `stock_lens_summary`: lightweight list/search profile.
- `stock_field_usage_manifest`: field-level usage and omission map.
- deterministic rules first; LLM narrative can be added later as a layer over
  bounded numeric facts and rule outputs.

## Development Sequence

1. Build full field inventory across stock detail, price/dividend history,
   institutional filings, sector, macro, and computed indexes.
2. Generate the usage manifest.
3. Generate per-symbol full profile and lightweight summary.
4. Add explainability UI: metric help, "how to read this", raw/pro view.
5. Add deterministic interpretation.
6. Add optional LLM API synthesis only after the deterministic layer is stable.

## Guardrails

- Never client-fetch every per-symbol detail file on a list page.
- Never make source-name-only cards.
- Never let generated narratives introduce facts not present in the bounded data
  profile.
- If a field is hidden from default UI, it must remain reachable through raw/pro
  view unless deprecated with a documented reason.
