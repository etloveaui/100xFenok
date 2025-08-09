# FenoK Repository – Codex Agent Guide

This document outlines structural, behavioral, and coding conventions for Codex when working on the FenoK static SPA repository. Follow these strictly to avoid structural conflicts or pathing issues.

---

## 🔧 Architecture Overview

- This is a **static Single-Page Application (SPA)** hosted on GitHub Pages.
- Core files live in the root directory. Content-specific files reside in subfolders:
  - `/100x/`, `/vr/`, `/ib/`, `/tools/`, `/posts/`, etc.
  - Corresponding `/preview/` folders may exist for testing purposes.

---

## 🧭 Navigation Structure

- Navigation and footer markup exist **only** in `index.html` and `404.html`, which act as the SPA shell.
- Content pages must **not** embed navigation or footer sections themselves.

### Required setup for each content HTML

**In `<head>`**
```html
<script type="module" src="../initBaseHref.js"></script>
```
(Adjust the `../` depth based on the file location.)

**At start of `<body>`**
```html
<div id="nav"></div>
```
This placeholder keeps the layout consistent even though navigation is not injected here.

---

## 📌 Link and Path Conventions

- Use **clean root-relative paths** (e.g., `href="posts/index.html"`)
- `data-path="..."` is used for internal SPA navigation.
- Avoid `./` and `../` except for scripts or assets.
- `<a>` tags used for routing must **always** include `data-path`.
- All internal links should point to `index.html?path=...` rather than directly to HTML files.
- `404.html` exists solely to redirect unknown URLs back to `index.html?path=...`.

---

## 📁 Preview Folder Rules

- Do **not** edit `/preview/` unless explicitly told.
- When mirroring changes, update all paths appropriately (e.g., `../../../initBaseHref.js`).
- preview/* must **never** be used as source for logic or copy unless a preview sync is active.

---

## 📄 File Editing Rules

- Content pages must include:
  - `<script type="module" src="../initBaseHref.js"></script>` with the correct relative path
  - `<div id="nav"></div>` as the first element in `<body>`
  - No embedded navigation or footer markup

---

## 🆕 When Adding a New Page

1. Add content under correct folder (`/posts/`, `/100x/daily-wrap/`, etc.)
2. Include the `initBaseHref.js` script and `<div id="nav"></div>` placeholder as shown above
3. Update `/posts/index.html` or `/100x/index.html` **only when prompted**
4. Bump `siteVersion` in `version.js` **only if instructed**
5. Run `node tests/run-tests.js` after major HTML changes

---

## 🔍 Testing

- Run the test suite before completing any PR:
```bash
node tests/run-tests.js
```
- HTML must pass with no critical errors (missing alt tags, broken links, etc.)

---

## 📄 Commit/PR Notes

- Always summarize each major change (e.g., "Updated VR calculator tables")
- List all edited files
- If version bumped, include version string (e.g., 20250703T0107)

---

_Last updated: 2025-07-05 by GPT-4 Codex Agent_
