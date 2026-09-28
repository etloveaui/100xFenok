import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { deriveExcludedPublicDataRoots } from "../../scripts/lib/lane-routing.mjs";

const appRoot = path.resolve(path.join(import.meta.dirname, ".."));
const scriptPath = path.join(appRoot, "scripts", "generate-static-route-manifest.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "static-route-manifest-"));

try {
  await mkdir(path.join(tempRoot, "public", "posts-raw", "nested"), { recursive: true });
  await mkdir(path.join(tempRoot, "public", "admin", "personal", "travel"), { recursive: true });
  await mkdir(path.join(tempRoot, "public", "data", "foo"), { recursive: true });
  const excludedAdminRoots = deriveExcludedPublicDataRoots().filter((root) => root.startsWith("admin/"));
  assert.ok(excludedAdminRoots.length > 0, "fixture requires at least one registry-derived excluded admin root");
  for (const root of excludedAdminRoots) {
    await mkdir(path.join(tempRoot, "public", "data", ...root.split("/")), { recursive: true });
    await writeFile(
      path.join(tempRoot, "public", "data", ...root.split("/"), "must-not-publish.json"),
      JSON.stringify({ private: true }),
    );
  }

  await writeFile(path.join(tempRoot, "public", "posts-raw", "alpha.html"), "<h1>alpha</h1>");
  await writeFile(path.join(tempRoot, "public", "posts-raw", "posts-main.html"), "<h1>main</h1>");
  await writeFile(path.join(tempRoot, "public", "posts-raw", "nested", "beta.html"), "<h1>beta</h1>");
  await writeFile(path.join(tempRoot, "public", "admin", "personal", "travel", "seoul.html"), "<h1>seoul</h1>");
  await writeFile(path.join(tempRoot, "public", "data", "foo", "bar.json"), JSON.stringify({ ok: true }));

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: tempRoot,
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const routeManifestPath = path.join(tempRoot, "src", "generated", "static-route-manifest.ts");
  const dataManifestPath = path.join(tempRoot, "public", "generated", "data-json-files-manifest.json");

  const routeManifest = await readFile(routeManifestPath, "utf-8");
  assert.match(routeManifest, /export const POST_HTML_FILES/);
  assert.match(routeManifest, /export const TRAVEL_HTML_FILES/);
  assert.doesNotMatch(routeManifest, /DATA_JSON_FILES_BY_PATH/);
  assert.doesNotMatch(routeManifest, /StaticDataJsonFileEntry/);

  const dataManifest = JSON.parse(await readFile(dataManifestPath, "utf-8"));
  assert.deepEqual(Object.keys(dataManifest), ["foo"]);
  assert.equal(dataManifest.foo[0].name, "bar.json");
  assert.equal(dataManifest.foo[0].sizeBytes, 11);
  assert.match(dataManifest.foo[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  for (const root of excludedAdminRoots) {
    assert.equal(
      Object.keys(dataManifest).some((directory) => directory === root || directory.startsWith(`${root}/`)),
      false,
      `excluded admin root leaked into Atlas input: ${root}`,
    );
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("[test-static-route-manifest-generator] OK");
