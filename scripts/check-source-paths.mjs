#!/usr/bin/env node
/**
 * Verify that all Next.js routes generated in the build manifest
 * resolve to physical source files inside the src/app directory.
 * Prevents shipping dynamic route maps that lack corresponding pages/routes.
 */

import fs from "node:fs";
import path from "node:path";

const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(SCRIPTS_DIR, "..");
const NEXT_DIR = path.join(ROOT, "100xfenok-next");
const MANIFEST_PATH = path.join(NEXT_DIR, ".next", "app-path-routes-manifest.json");

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`ERROR: Build manifest not found at: ${MANIFEST_PATH}. Run cf:build first.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
let missingCount = 0;

console.log(`Checking route manifest: ${Object.keys(manifest).length} routes...`);

for (const key of Object.keys(manifest)) {
  let relPath = key;
  
  // Next.js App Router special dynamic mappings to app directory files
  if (key === "/_global-error/page") {
    // If global-error is missing, Next.js falls back to default global-error,
    // or we can verify error.tsx presence.
    relPath = fs.existsSync(path.join(NEXT_DIR, "src", "app", "global-error.tsx")) ? "/global-error" : "/error";
  } else if (key === "/_not-found/page") {
    relPath = "/not-found";
  } else if (key === "/manifest.webmanifest/route") {
    relPath = "/manifest";
  } else if (key === "/robots.txt/route") {
    relPath = "/robots";
  } else if (key === "/sitemap.xml/route") {
    relPath = "/sitemap";
  }

  const sourceBase = path.join(NEXT_DIR, "src", "app", relPath);
  let found = false;

  for (const ext of EXTENSIONS) {
    const fullPath = sourceBase + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      found = true;
      break;
    }
  }

  if (!found) {
    console.error(`[FAIL] Route "${key}" cannot be resolved. Expected src/app${relPath}{.tsx|.ts|.jsx|.js}`);
    missingCount++;
  }
}

if (missingCount > 0) {
  console.error(`\nCheck failed: ${missingCount} route source files are missing.`);
  process.exit(1);
}

console.log("SUCCESS: All build manifest routes resolve to physical source files.");
process.exit(0);
