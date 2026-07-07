# FenoK Dashboard

FenoK is a collection of investment dashboards and tools. The canonical public app is now the Next/OpenNext application in `100xfenok-next/`, served from Cloudflare Workers. The old GitHub Pages iframe SPA root has been retired.

## Local Checks

Root content folders are still kept as static sources and data inputs for the Next app. Run the small legacy-content smoke test from this directory when changing those folders.

```bash
npm install       # only if tests require additional modules
node tests/run-tests.js
```

## File Structure

```
/100x           Daily wrap articles and related pages
/ib             Infinite buy calculator
/vr             VR system documentation and calculators
/posts          Analysis posts
/tools          Auxiliary tools (e.g., multichart)
/100xfenok-next Canonical Next/OpenNext app and Cloudflare Worker config
```

The preserved static content is mirrored into `100xfenok-next/public/` by the
Next app's sync pipeline. New public navigation and shell behavior should be
implemented in `100xfenok-next/`, not by recreating a root `index.html` iframe
shell.

## Canonical App

Use `100xfenok-next/README.md` and `100xfenok-next/package.json` for local
development, Cloudflare build, and deploy commands.

## Contributing

Pull requests are welcome. Please run `node tests/run-tests.js` before submitting changes and ensure HTML pages remain valid. By contributing you agree that your contributions will be licensed under the MIT License as detailed in the LICENSE file. Describe any significant changes in your commit messages.

## Codex & AI Contributors

For all automated or AI-assisted contributions (Codex, Gemini, GPT, etc.), please refer to `AGENTS.md` in the root directory.  
It contains required rules for HTML structure, version control, preview sync, and file path conventions.
