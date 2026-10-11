import assert from "node:assert/strict";
import { createElement } from "react";
import Image from "next/image";
import { renderToStaticMarkup } from "react-dom/server";

import DesignLabProfilePreview from "../src/components/DesignLabProfilePreview";

const PROTECTED_PREFIX = "/admin/design-lab/screenshots/";

// A separate public Image still uses Next's optimizer by default.
const publicHtml = renderToStaticMarkup(createElement(Image, {
  src: "/favicon-192x192.png", alt: "Public optimizer control", width: 192, height: 192,
}));
assert.match(publicHtml, /src="[^"]*\/_next\/image\?/, "public Image must retain optimization");

// --- Render assertion: 7 raw protected <img> sources, no optimizer URLs. ---
const html = renderToStaticMarkup(createElement(DesignLabProfilePreview));
const renderedSources = Array.from(
  html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g),
  (match) => match[1],
);
assert.equal(
  renderedSources.filter((src) => src.includes("/_next/image")).length,
  0,
  "rendered images must bypass the optimizer",
);
for (const src of renderedSources) {
  assert.ok(
    src.startsWith(PROTECTED_PREFIX),
    `rendered source must stay under the admin-protected prefix: ${src}`,
  );
  assert.equal(
    html.includes(`src="${src}"`),
    true,
    "every protected source must appear verbatim in rendered markup",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: "design-lab-image-unoptimized",
      assets_covered: renderedSources.length,
      optimizer_refs_in_render: 0,
    },
    null,
    2,
  ),
);
