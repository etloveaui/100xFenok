import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const normalize = (value) => value.trim().replace(/\s+/g, " ");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `invalid hex color: ${hex}`);
  const value = match[1];
  const red = linearChannel(Number.parseInt(value.slice(0, 2), 16));
  const green = linearChannel(Number.parseInt(value.slice(2, 4), 16));
  const blue = linearChannel(Number.parseInt(value.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function neutralOklchLuminance(lightness) {
  // For achromatic OKLCH, OKLab l/m/s all equal L and linear sRGB is L^3.
  return lightness ** 3;
}

function neutralOklchHex(lightness) {
  const linear = neutralOklchLuminance(lightness);
  const encoded = linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
  const channel = Math.round(encoded * 255).toString(16).padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}

function contrastRatio(first, second) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertRatio(label, foreground, background, minimum) {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(3)} must be >= ${minimum}`);
  return ratio;
}

const light = {
  body: hexLuminance("#64748b"),
  faint: hexLuminance("#767f8c"),
  panel: hexLuminance("#ffffff"),
  muted: hexLuminance("#f8fafc"),
  slate100: hexLuminance("#f1f5f9"),
};

for (const [surface, background] of [["panel", light.panel], ["muted", light.muted]]) {
  assertRatio(`light body on ${surface}`, light.body, background, 4.5);
  assertRatio(`light faint/large on ${surface}`, light.faint, background, 3);
}

const darkHex = {
  background: neutralOklchHex(0.205),
  panel: neutralOklchHex(0.255),
  muted: neutralOklchHex(0.32),
  faint: neutralOklchHex(0.67),
  body: neutralOklchHex(0.76),
};
const dark = Object.fromEntries(
  Object.entries(darkHex).map(([name, value]) => [name, hexLuminance(value)]),
);

assert.equal(darkHex.faint, "#959595", "dark faint neutral-500 resolves to measured #959595");
for (const surface of ["background", "panel", "muted"]) {
  assertRatio(`dark body on ${surface}`, dark.body, dark[surface], 4.5);
  assertRatio(`dark faint/large on ${surface}`, dark.faint, dark[surface], 3);
}

const globals = read("src/app/globals.css");
const shell = read("src/styles/app-shell.css");
assert.match(globals, /--fnk-neutral-400: #94a3b8;/, "global neutral-400 stays isolated and unchanged");
assert.match(globals, /--fnk-neutral-500: #64748b;/, "global light ink-3 source stays pinned");
assert.match(globals, /--fnk-neutral-500: oklch\(0\.67 0 0\);/, "dark faint source stays neutral-500");
assert.match(globals, /--fnk-neutral-600: oklch\(0\.76 0 0\);/, "dark body source stays neutral-600");
assert.match(shell, /--shell-foreground-faint:#767f8c;/, "light shell faint stays approved #767f8c");
assert.match(shell, /--shell-foreground-faint:var\(--fnk-neutral-500\)/, "dark shell faint stays measured neutral-500");

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

const sourceFiles = walkFiles(path.join(root, "src"));
const sourceEntries = sourceFiles.map((absolute) => ({
  path: path.relative(root, absolute).split(path.sep).join("/"),
  source: fs.readFileSync(absolute, "utf8"),
}));
const countAll = (needle) => sourceEntries.reduce((sum, entry) => sum + entry.source.split(needle).length - 1, 0);

const colorUtility400 = /\b(?:text|bg|border(?:-[trblxyse])?|outline|ring|ring-offset|fill|stroke|decoration)-(?:slate|gray|zinc|neutral|stone)-400\b/g;

function assertAliasClosure(entries) {
  const consumers = entries.flatMap((entry) => [...entry.source.matchAll(colorUtility400)].map((match) => ({
    path: entry.path,
    token: match[0],
  })));
  assert.deepEqual(
    consumers,
    [{ path: "src/components/ExternalSourceLinks.tsx", token: "text-slate-400" }],
    "ink-4 Tailwind alias closure gained an unclassified consumer",
  );
}

assertAliasClosure(sourceEntries);

assert.equal(countAll("text-slate-400"), 1, "only the decorative external-link glyph may retain text-slate-400");
assert.equal(countAll("bg-slate-400"), 0, "meaningful slate-400 fills must migrate to slate-500");
assert.equal(countAll("outline-slate-400"), 0, "focus outlines must clear the 3:1 floor");
assert.equal(countAll("var(--fnk-neutral-400)"), 1, "only the global ink-4 mapping may consume neutral-400");
assert.equal(countAll("var(--ink-4)"), 3, "only two global mappings and one decorative glyph may retain ink-4");

assert.match(
  read("src/components/ExternalSourceLinks.tsx"),
  /aria-hidden className="font-semibold text-slate-400"/,
  "decorative external-link glyph remains the sole Tailwind text survivor",
);
assert.match(
  read("src/styles/ib-light-v2.css"),
  /\.ib-ord__chev\s*\{[^}]*color:\s*var\(--ink-4\)/s,
  "decorative order chevron remains the sole direct ink-4 render consumer",
);
assert.match(
  read("src/components/ib/v2/OrderPlanCard.tsx"),
  /className="ib-ord__chev" aria-hidden="true"/,
  "the retained order chevron must remain hidden from assistive technology",
);
assert.match(
  read("src/styles/cp-w4-screener.css"),
  /\.cpw4-search__input\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*900;[^}]*\}[\s\S]*?\.cpw4-search__input::placeholder\s*\{\s*color:\s*#64748b;/,
  "the approved 18px placeholder stays on body ink-3",
);

assert.throws(
  () => assertAliasClosure([...sourceEntries, { path: "mutation.tsx", source: '<span className="text-gray-400" />' }]),
  /alias closure/,
);
assert.throws(
  () => assertAliasClosure([...sourceEntries, { path: "mutation.tsx", source: '<svg className="stroke-slate-400" />' }]),
  /alias closure/,
);

const candidatePattern = /var\(--c-ink-3\)|theme\.token\("ink3"\)|#64748b|text-slate-500|bg-slate-500|outline-slate-500|var\(--fnk-neutral-500\)|var\(--ink-3\)/;

function targetOccurrences(source) {
  const lines = source.split(/\r?\n/);
  const occurrences = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    if (!candidatePattern.test(lines[index])) continue;
    const hash = sha256(normalize(lines[index]));
    occurrences.set(hash, (occurrences.get(hash) ?? 0) + 1);
  }
  return occurrences;
}

function lineEvidence(source) {
  const evidence = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = normalize(rawLine);
    const hash = sha256(line);
    const current = evidence.get(hash) ?? { count: 0, line };
    current.count += 1;
    evidence.set(hash, current);
  }
  return evidence;
}

function supportsBackground(line, surface) {
  if (surface === "panel") return /bg-white|bg-\[var\(--c-panel\)\]|background:\s*var\(--c-panel\)|var\(--paper-1\)|--fnk-color-card:\s*#ffffff/.test(line);
  if (surface === "muted") return /bg-slate-50|bg-\[var\(--c-surface-2\)\]|background:\s*var\(--c-surface-2\)|var\(--paper-0\)|--fnk-color-background:\s*#f8fafc/.test(line);
  if (surface === "slate100") return /bg-slate-100|--fnk-neutral-100:\s*#f1f5f9/.test(line);
  return false;
}

function renderContractHash(sites) {
  const payload = sites.map((site) => [
    site.id,
    site.path,
    site.target_hash,
    site.occurrence,
    site.foreground,
    site.background,
    site.role,
    site.min_ratio,
    site.exemption ?? "",
    site.background_evidence.path,
    site.background_evidence.target_hash,
    site.background_evidence.occurrence,
    site.background_evidence.surface,
  ].join("|")).join("\n");
  return sha256(payload);
}

export function validateRenderManifest(manifest, reader = read) {
  assert.equal(manifest.schema_version, "ink4-render-sites/v2");
  assert.equal(manifest.site_count, 121, "77 original + 44 residual render lines must stay pinned");
  assert.equal(manifest.consumer_count, 122, "77 original + 45 residual consumers must stay classified");
  assert.equal(manifest.sites.length, manifest.site_count, "render manifest denominator drifted");
  assert.deepEqual(
    manifest.surfaces,
    { panel: "#ffffff", muted: "#f8fafc", slate100: "#f1f5f9" },
    "audited surface palette drifted",
  );
  assert.equal(renderContractHash(manifest.sites), manifest.contract_hash, "render manifest contract hash drifted");

  const roles = manifest.sites.reduce((counts, site) => {
    counts[site.role] = (counts[site.role] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(
    roles,
    { body_text: 110, non_text: 8, mixed_text_non_text: 1, inactive_control: 2 },
    "text, non-text, or inactive-control classification drifted",
  );

  const byPath = new Map();
  const evidenceByPath = new Map();
  for (const site of manifest.sites) {
    if (!byPath.has(site.path)) byPath.set(site.path, targetOccurrences(reader(site.path)));
    const actualCount = byPath.get(site.path).get(site.target_hash) ?? 0;
    assert.ok(actualCount >= site.occurrence, `${site.id} render target hash drifted`);
    assert.equal(site.foreground, "ink3", `${site.id} foreground token drifted`);

    assert.equal(site.background_evidence.surface, site.background, `${site.id} background evidence surface mismatch`);
    if (!evidenceByPath.has(site.background_evidence.path)) {
      evidenceByPath.set(site.background_evidence.path, lineEvidence(reader(site.background_evidence.path)));
    }
    const evidence = evidenceByPath.get(site.background_evidence.path).get(site.background_evidence.target_hash);
    assert.ok(evidence?.count >= site.background_evidence.occurrence, `${site.id} background evidence hash drifted`);
    assert.ok(supportsBackground(evidence.line, site.background), `${site.id} background evidence does not resolve to ${site.background}`);

    const backgroundHex = manifest.surfaces[site.background];
    assert.ok(backgroundHex, `${site.id} has an unknown background surface`);
    const ratio = contrastRatio(light.body, hexLuminance(backgroundHex));
    if (site.role === "inactive_control") {
      assert.equal(site.min_ratio, 0, `${site.id} inactive control must not claim a 4.5 threshold`);
      assert.equal(site.exemption, "WCAG 1.4.3 inactive user interface component");
      assert.ok(ratio < 4.5, `${site.id} exemption is stale because the pair now clears body contrast`);
      continue;
    }

    const expectedMinimum = site.role === "non_text" ? 3 : 4.5;
    assert.equal(site.min_ratio, expectedMinimum, `${site.id} role threshold drifted`);
    assert.ok(ratio >= site.min_ratio, `${site.id}: ${ratio.toFixed(3)} must be >= ${site.min_ratio}`);
  }
  return true;
}

const manifest = JSON.parse(read("scripts/fixtures/ink4-contrast-sites.json"));
assert.equal(validateRenderManifest(manifest), true);

const firstSiteSource = read("src/app/etfs/[ticker]/EtfDetailClient.tsx");
const revertedReader = (relativePath) => relativePath === "src/app/etfs/[ticker]/EtfDetailClient.tsx"
  ? firstSiteSource.replace(
      'className="block truncate max-w-[14rem] text-[11px] font-semibold text-[var(--c-ink-3)]"',
      'className="block truncate max-w-[14rem] text-[11px] font-semibold text-[var(--c-ink-4)]"',
    )
  : read(relativePath);
assert.throws(() => validateRenderManifest(manifest, revertedReader), /render target hash drifted/);

const removedReader = (relativePath) => relativePath === "src/components/admin-live/AdminLiveBench.tsx"
  ? read(relativePath).replace(
      '<span className="text-xs font-semibold text-slate-500">{log.at}</span>',
      '<span className="text-xs font-semibold text-slate-600">{log.at}</span>',
    )
  : read(relativePath);
assert.throws(() => validateRenderManifest(manifest, removedReader), /render target hash drifted/);

const neighborOnlyReader = (relativePath) => relativePath === "src/app/etfs/[ticker]/EtfDetailClient.tsx"
  ? firstSiteSource.replace(
      '<span className="orbitron text-xs font-black text-[var(--c-ink)]">{item.symbol}</span>',
      '<span data-hash-neighbor="changed" className="orbitron text-xs font-black text-[var(--c-ink)]">{item.symbol}</span>',
    )
  : read(relativePath);
assert.equal(validateRenderManifest(manifest, neighborOnlyReader), true, "neighbor-only copy must not invalidate target hashes");

const swappedSurface = structuredClone(manifest);
swappedSurface.sites[0].background = swappedSurface.sites[0].background === "panel" ? "muted" : "panel";
swappedSurface.contract_hash = renderContractHash(swappedSurface.sites);
assert.throws(() => validateRenderManifest(swappedSurface), /background evidence surface mismatch/);

const missingPin = structuredClone(manifest);
missingPin.sites.pop();
missingPin.contract_hash = renderContractHash(missingPin.sites);
assert.throws(() => validateRenderManifest(missingPin), /render manifest denominator drifted/);

console.log("ink-4 contrast unit + role-bound render-target hash contract: PASS");
