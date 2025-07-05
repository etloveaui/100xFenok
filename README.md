# FenoK Dashboard

FenoK is a collection of investment dashboards and tools built as a simple Single Page Application. Navigation and content are served as static HTML so the project can be hosted from any static file server. The SPA has exactly one entry point: `index.html`.

## Installation

No build step is required. Clone the repository and serve the directory using a simple HTTP server. Opening the files directly from disk can trigger cross-origin issues and some CDN assets may not load. Start a local server such as `npx serve` or `python -m http.server` and then browse to `index.html`. Node is only required to run the small test suite.

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
index.html      SPA entry containing the iframe loader
404.html        Redirects any unknown URL to `index.html?path=...`
version.js      Cache busting constant
```

## Usage

After starting a local server, open `index.html` in your browser to launch the application. All internal navigation uses the `?path=` query to load content pages. `404.html` performs a universal redirect so any deep link or broken URL is absorbed back into `index.html?path=...`.

## Updating preview/

The `preview/` folder serves a GitHub Pages preview of the site. After modifying pages or assets in the project root, copy the updated files here so the preview stays in sync. Typically this includes `index.html`, `main.html`, `version.js`, `site.webmanifest`, `404.html` and any updated icon files.

## Contributing

Pull requests are welcome. Please run `node tests/run-tests.js` before submitting changes and ensure HTML pages remain valid. By contributing you agree that your contributions will be licensed under the MIT License as detailed in the LICENSE file. Describe any significant changes in your commit messages.

## Codex & AI Contributors

For all automated or AI-assisted contributions (Codex, Gemini, GPT, etc.), please refer to `AGENTS.md` in the root directory.  
It contains required rules for HTML structure, version control, preview sync, and file path conventions.
