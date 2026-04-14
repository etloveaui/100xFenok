# Admin Notification Cache Data

> **Source**: GitHub repository tree
> **Update**: Hourly
> **Files**: 1

---

## Overview

Cached folder listings for `notification-control-panel-web.html` so the browser can read same-origin JSON instead of calling the GitHub Contents API directly.

## File Catalog

| File | Description | Update |
|------|-------------|--------|
| `notification-folders.json` | Latest HTML file listings for Daily Wrap, Alpha Scout, and Strategic Briefing | Hourly |

## Contract

1. Consumers should read `data/admin/notification-folders.json` only.
2. The file is pre-sorted with the newest HTML file first in each folder.
3. Browser code must not call `api.github.com/repos/.../contents/` for notification folder discovery.

---

*Last Updated: 2026-04-14*
