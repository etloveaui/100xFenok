# FenoK Dashboard

FenoK is a collection of investment dashboards and tools built as a simple Single Page Application. Navigation and content are served as static HTML so the project can be hosted from any static file server.

## Installation

No build step is required. Clone the repository and open `index.html` in a browser or serve the directory using a static HTTP server. Node is only required to run the small test suite.

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

Open `index.html` to launch the application. The navigation menu lets you switch between tools and articles. When adding new pages, update `nav.html` and increase the version in `version.js` so browsers fetch the latest resources.

## Contributing

Pull requests are welcome. Please run `node tests/run-tests.js` before submitting changes and ensure HTML pages remain valid. Describe any significant changes in your commit messages.
