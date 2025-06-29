# FenoK Dashboard

FenoK is a collection of investment dashboards and tools built as a simple Single Page Application. Navigation and content are served as static HTML so the project can be hosted from any static file server.

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
nav.html        Navigation bar loaded by the SPA
index.html      Main entry point containing the iframe loader
version.js      Cache busting constant
```

## Usage

After starting a local server, open `index.html` in your browser to launch the application. The navigation menu lets you switch between tools and articles. When adding new pages, update `nav.html` and increase the version in `version.js` so browsers fetch the latest resources.

## Updating preview/

The `preview/` folder serves a GitHub Pages preview of the site. After modifying pages or assets in the project root, copy the updated files here so the preview stays in sync. Typically this includes `index.html`, `nav.html`, `main.html`, `version.js`, `site.webmanifest`, `404.html` and any updated icon files.

## Contributing

Pull requests are welcome. Please run `node tests/run-tests.js` before submitting changes and ensure HTML pages remain valid. By contributing you agree that your contributions will be licensed under the MIT License as detailed in the LICENSE file. Describe any significant changes in your commit messages.
