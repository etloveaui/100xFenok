# Admin Data

> **Source**: repository-generated operational manifests
> **Scope**: admin and data-readiness metadata

---

## Overview

This directory stores lightweight admin/readiness manifests. Public-safe mirrors
are compacted by the static sync pipeline; private-only control-plane ledgers
must stay out of `100xfenok-next/public/data/admin/`.

Private-only examples:

- `fenok-s0-finra-occ-mapping-ledger.json` — local FINRA/OCC non-plain mapping
  ledger with row-level local evidence paths.

The legacy GitHub Pages notification panel and its `notification-folders.json` cache were retired on 2026-07-07.

*Last Updated: 2026-07-09*
