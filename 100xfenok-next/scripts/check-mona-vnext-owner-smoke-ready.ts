import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Status = "PASS" | "WARN" | "FAIL";

type Check = {
  id: string;
  status: Status;
  detail: string;
};

const appRoot = process.cwd();
const args = process.argv.slice(2);
const baseUrl = readArg("--base-url");

function readArg(name: string) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).replace(/\/+$/, "");
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1]?.replace(/\/+$/, "") ?? "";
  return "";
}

function check(id: string, status: Status, detail: string): Check {
  return { id, status, detail };
}

function readRel(relPath: string) {
  return readFileSync(path.join(appRoot, relPath), "utf8");
}

function walkTextFiles(relDir: string) {
  const root = path.join(appRoot, relDir);
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (/\.(ts|tsx|js|mjs|json|css)$/.test(entry.name)) {
        if (fullPath.includes(`${path.sep}gates${path.sep}`)) continue;
        files.push(fullPath);
      }
    }
  }
  return files;
}

function checkSourceInvariants(): Check[] {
  const winddown = readRel("src/app/winddown/page.tsx");
  const winddownVnext = readRel("src/app/winddown-vnext/page.tsx");
  const liveSetup = readRel("src/features/mona-vnext/server/liveSetup.ts");
  const vnextFiles = [
    ...walkTextFiles("src/features/mona-vnext"),
    ...walkTextFiles("src/app/api/mona-vnext"),
    ...walkTextFiles("src/app/winddown-vnext"),
  ];
  const forbidden = [
    "saveStudySession",
    "mona-english",
    "buildLiveSetup",
    "registerLiveToolSessionContext",
    "/api/admin/live",
  ];
  const forbiddenHits = vnextFiles.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return forbidden
      .filter((needle) => text.includes(needle))
      .map((needle) => `${path.relative(appRoot, file)}:${needle}`);
  });

  return [
    check(
      "winddown-current-runtime",
      winddown.includes("<AdminLiveBench initialMode=\"mona\" simpleUi") ? "PASS" : "FAIL",
      "/winddown still renders AdminLiveBench initialMode=\"mona\" simpleUi",
    ),
    check(
      "vnext-no-admin-core",
      winddownVnext.includes("MonaVoiceCoachApp") && !winddownVnext.includes("AdminLiveBench") ? "PASS" : "FAIL",
      "/winddown-vnext renders MonaVoiceCoachApp without AdminLiveBench import",
    ),
    check(
      "vnext-no-production-write-path",
      forbiddenHits.length === 0 ? "PASS" : "FAIL",
      forbiddenHits.length === 0 ? "no production Mona write/import path found" : forbiddenHits.join(", "),
    ),
    check(
      "vnext-live-setup-shape",
      liveSetup.includes("responseModalities: [\"AUDIO\"]")
        && liveSetup.includes("NO_INTERRUPTION")
        && liveSetup.includes("inputAudioTranscription")
        && liveSetup.includes("outputAudioTranscription")
        && !liveSetup.includes("functionDeclarations")
        && !liveSetup.includes("tools:")
        ? "PASS"
        : "FAIL",
      "AUDIO/no-interrupt/transcription setup with no tools/functionDeclarations",
    ),
  ];
}

async function checkRouteReadiness(): Promise<Check[]> {
  if (!baseUrl) {
    return [
      check("route-smoke", "WARN", "skipped; pass --base-url=http://127.0.0.1:3030 after starting dev server"),
      check("session-readiness", "WARN", "skipped; pass --base-url=http://127.0.0.1:3030 after starting dev server"),
    ];
  }

  const checks: Check[] = [];
  try {
    const page = await fetch(`${baseUrl}/winddown-vnext/`, { cache: "no-store" });
    checks.push(check("route-smoke", page.ok ? "PASS" : "FAIL", `/winddown-vnext/ HTTP ${page.status}`));
  } catch (error) {
    checks.push(check("route-smoke", "FAIL", error instanceof Error ? error.message : "route fetch failed"));
  }

  try {
    const response = await fetch(`${baseUrl}/api/mona-vnext/session/`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as
      | { readiness?: { status?: unknown; namespace?: { productionWriteEnabled?: unknown } } }
      | null;
    const ready = response.ok
      && payload?.readiness?.status === "READY"
      && payload.readiness.namespace?.productionWriteEnabled === false;
    checks.push(check(
      "session-readiness",
      ready ? "PASS" : "FAIL",
      `HTTP ${response.status}, readiness=${String(payload?.readiness?.status ?? "unknown")}, productionWriteEnabled=${String(payload?.readiness?.namespace?.productionWriteEnabled ?? "unknown")}`,
    ));
  } catch (error) {
    checks.push(check("session-readiness", "FAIL", error instanceof Error ? error.message : "readiness fetch failed"));
  }

  return checks;
}

function checkOwnerLogPath(): Check[] {
  const relDir = "data/voice-logs-vnext/owner-test";
  const logDir = path.join(appRoot, relDir);
  if (!existsSync(logDir)) {
    return [
      check("owner-log-dir", "WARN", `${relDir} does not exist yet; real owner smoke has not produced a log`),
    ];
  }

  const files = readdirSync(logDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { name, fullPath, mtimeMs: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    return [check("owner-log-file", "WARN", `${relDir} exists but has no JSON logs`)];
  }

  const latest = path.join(relDir, files[0].name);
  return [
    check("owner-log-file", "PASS", `latest=${latest}`),
    check("owner-score-command", "PASS", `npm run score:mona-vnext-session -- ${latest}`),
  ];
}

async function main() {
  const checks = [
    ...checkSourceInvariants(),
    check(
      "shell-gemini-key",
      process.env.GEMINI_API_KEY ? "PASS" : "WARN",
      process.env.GEMINI_API_KEY ? "GEMINI_API_KEY present in this shell" : "GEMINI_API_KEY missing in this shell; server env may still provide it",
    ),
    ...(await checkRouteReadiness()),
    ...checkOwnerLogPath(),
  ];

  for (const item of checks) {
    console.log(`${item.status} ${item.id} - ${item.detail}`);
  }

  if (checks.some((item) => item.status === "FAIL")) {
    process.exitCode = 1;
  }
}

void main();
