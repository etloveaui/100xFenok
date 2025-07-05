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

- Do **NOT** hardcode nav into each HTML file.
- All pages must dynamically inject `<div id="nav"></div>` and run `loadNav(siteVersion)` from `loadNav.js`.

### Required setup for each HTML:

**In `<head>`**
```html
<script type="module" src="./initBaseHref.js"></script>
```
(Use `../` or `../../` based on file depth)

**At top of `<body>`**
```html
<div id="nav"></div>
```

**At bottom of `<body>`**
```html
<script type="module">
  const { siteVersion } = await import(`${window.baseHref}version.js`);
  const { loadNav } = await import(`${window.baseHref}loadNav.js`);
  if (window.top === window.self) {
      await loadNav(siteVersion);
  }
</script>
```

---

## 📌 Link and Path Conventions

- Use **clean root-relative paths** (e.g., `href="posts/index.html"`)
- `data-path="..."` is used for internal SPA navigation.
- Avoid `./` and `../` except for scripts or assets.
- `<a>` tags used for routing must **always** include `data-path`.

---

## 📁 Preview Folder Rules

- Do **not** edit `/preview/` unless explicitly told.
- When mirroring changes, update all paths appropriately (e.g., `../../../initBaseHref.js`).
- preview/* must **never** be used as source for logic or copy unless a preview sync is active.

---

## 📄 File Editing Rules

- Every file must include:
  - initBaseHref
  - version.js
  - loadNav.js
  - div#nav container

---

## 🆕 When Adding a New Page

1. Add content under correct folder (`/posts/`, `/100x/daily-wrap/`, etc.)
2. Include nav injection logic as above
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

- Always summarize each major change (e.g., "Applied nav injection to Alpha Pick post")
- List all edited files
- If version bumped, include version string (e.g., 20250703T0107)

---

_Last updated: 2025-07-05 by GPT-4 Codex Agent_
