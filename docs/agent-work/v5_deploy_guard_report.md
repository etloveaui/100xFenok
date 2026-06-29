# v5 배포 가드레일 (P3 Anti-Breakage Guards) 구현 보고서

> **문서 상태**: 검증 완료 (Verified)  
> **대상 범위**: `.github/workflows/deploy-worker.yml` 검사 강화 및 빌드 라우트 무결성 스크립트 구축  
> **검토 목적**: 배포 실패 및 런타임 404를 사전에 차단하기 위한 fail-fast 및 빌드 매니페스트 역추적 검증  

---

## 1. 구현 내용 요약 (Implementation Summary)

1. **Cloudflare API Token 존재 유무 검증 (Fail-fast)**:
   - `.github/workflows/deploy-worker.yml`에서 `wrangler deploy` 착수 직전에 토큰 비어있음 유무를 검사해 명확한 에러 로깅 후 `exit 1` 처리하는 안전 장치 추가.
2. **빌드 매니페스트 라우트 실존 검증 스크립트 (`scripts/check-source-paths.mjs`)**:
   - Next.js 컴파일 매니페스트인 `.next/app-path-routes-manifest.json`을 역파싱하여 `src/app` 하위 실제 소스 파일(page.tsx, route.ts, manifest.ts 등)이 존재하지 않는 경우 배포 프로세스를 즉각 거부(`exit 1`)하도록 설계.
   - `global-error`, `not-found`, `manifest`, `robots`, `sitemap` 등 Next.js의 특수 컴파일 경로 매핑 보완 완료.

---

## 2. `.github/workflows/deploy-worker.yml` Git Diff

```diff
diff --git a/.github/workflows/deploy-worker.yml b/.github/workflows/deploy-worker.yml
index 853c41e2fa..d5ef82480c 100644
--- a/.github/workflows/deploy-worker.yml
+++ b/.github/workflows/deploy-worker.yml
@@ -83,6 +83,18 @@ jobs:
         working-directory: 100xfenok-next
         run: npm run cf:build
 
+      - name: Verify build manifest routes presence
+        run: node scripts/check-source-paths.mjs
+
+      - name: Verify Cloudflare token presence
+        env:
+          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
+        run: |
+          if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
+            echo "ERROR: CLOUDFLARE_API_TOKEN secret is missing or empty. Deploy cannot proceed."
+            exit 1
+          fi
+
       - name: Deploy to Cloudflare Workers
         working-directory: 100xfenok-next
         run: npx wrangler deploy
```

---

## 3. 신규 검증 스크립트 소스 (`scripts/check-source-paths.mjs`)

```javascript
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
```

---

## 4. 로컬 검증 결과 (Exit Codes Verification)

- **`node scripts/check-source-paths.mjs`**: **`exit 0`** (통과 완료)
  - `Checking route manifest: 72 routes...`
  - `SUCCESS: All build manifest routes resolve to physical source files.`
- **`ruby scripts/ops/validate-workflow-yaml.rb`**: **`exit 0`** (YAML 문법 파싱 100% 정상 통과)
  - `Validated 24 workflow YAML file(s).`
  - `PASS .github/workflows/deploy-worker.yml`
