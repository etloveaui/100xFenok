import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import Image from "next/image";
import { renderToStaticMarkup } from "react-dom/server";

import DesignLabProfilePreview from "../src/components/DesignLabProfilePreview";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const componentRel = "src/components/DesignLabProfilePreview.tsx";
const componentPath = path.join(appRoot, componentRel);
const source = fs.readFileSync(componentPath, "utf8");

const PROTECTED_PREFIX = "/admin/design-lab/screenshots/";
const EXPECTED_ASSETS = [
  `${PROTECTED_PREFIX}figma-profile-avatar.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-1.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-2.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-3.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-4.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-5.jpg`,
  `${PROTECTED_PREFIX}figma-profile-grid-6.jpg`,
].sort();

// --- Source assertions: ONLY the 3 authorized JSX usages, all 7 assets. ---
const imageUsages = source.match(/<Image[\s>]/g) ?? [];
assert.equal(imageUsages.length, 3, "exactly 3 Image JSX usages are authorized");
const unoptimizedCount = (source.match(/\bunoptimized\b/g) ?? []).length;
assert.equal(
  unoptimizedCount,
  3,
  "each of the 3 authorized Image usages must carry unoptimized",
);

const referenced = [
  ...new Set(
    Array.from(
      source.matchAll(/\/admin\/design-lab\/screenshots\/[A-Za-z0-9._-]+/g),
      (match) => match[0],
    ),
  ),
].sort();
assert.deepEqual(
  referenced,
  EXPECTED_ASSETS,
  "the component must reference exactly the 7 protected screenshot assets",
);
assert.equal(
  source.includes("/_next/image"),
  false,
  "the component must not reference the optimizer",
);

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
assert.equal(renderedSources.length, 7, "rendered markup must expose 7 images");
assert.equal(
  renderedSources.filter((src) => src.includes("/_next/image")).length,
  0,
  "rendered images must bypass the optimizer",
);
assert.deepEqual(
  [...new Set(renderedSources)].sort(),
  EXPECTED_ASSETS,
  "rendered image sources must be exactly the 7 protected paths",
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
      image_jsx_usages: imageUsages.length,
      unoptimized_markers: unoptimizedCount,
      assets_covered: renderedSources.length,
      optimizer_refs_in_render: 0,
      localized_to: componentRel,
    },
    null,
    2,
  ),
);
