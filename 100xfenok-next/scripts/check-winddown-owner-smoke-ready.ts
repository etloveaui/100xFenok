import { readFileSync } from "node:fs";
import path from "node:path";

type Status = "PASS" | "WARN" | "FAIL";

type Check = {
  id: string;
  status: Status;
  detail: string;
};

type RouteContract = {
  id: string;
  route: string;
  page: string;
  client: string;
  clientSymbol: string;
};

const appRoot = process.cwd();
const args = process.argv.slice(2);
const sourceOnly = args.includes("--source-only");
const baseUrl = readArg("--base-url") || process.env.QA_BASE_URL || "";

const ROUTES: RouteContract[] = [
  {
    id: "home",
    route: "/winddown/",
    page: "src/app/winddown/page.tsx",
    client: "src/features/winddown/habit/ui/WindDownHabitHomeClient.tsx",
    clientSymbol: "WindDownHabitHomeClient",
  },
  {
    id: "learn",
    route: "/winddown/learn/",
    page: "src/app/winddown/learn/page.tsx",
    client: "src/features/winddown/ui/WindDownLearnClient.tsx",
    clientSymbol: "WindDownLearnClient",
  },
  {
    id: "review",
    route: "/winddown/review/",
    page: "src/app/winddown/review/page.tsx",
    client: "src/features/winddown/ui/WindDownReviewClient.tsx",
    clientSymbol: "WindDownReviewClient",
  },
  {
    id: "drill",
    route: "/winddown/drill/",
    page: "src/app/winddown/drill/page.tsx",
    client: "src/features/winddown/drill/ui/WindDownDrillClient.tsx",
    clientSymbol: "WindDownDrillClient",
  },
  {
    id: "game",
    route: "/winddown/game/",
    page: "src/app/winddown/game/page.tsx",
    client: "src/features/winddown/game/ui/WindDownGameClient.tsx",
    clientSymbol: "WindDownGameClient",
  },
  {
    id: "roleplay",
    route: "/winddown/roleplay/",
    page: "src/app/winddown/roleplay/page.tsx",
    client: "src/features/winddown/voice/ui/WindDownVoiceClient.tsx",
    clientSymbol: "WindDownVoiceClient",
  },
  {
    id: "live-talk",
    route: "/winddown/live-talk/",
    page: "src/app/winddown/live-talk/page.tsx",
    client: "src/features/winddown/voice/ui/WindDownVoiceClient.tsx",
    clientSymbol: "WindDownVoiceClient",
  },
];

const READ_BOOTSTRAPS = [
  { id: "habit", route: "/api/winddown/habit/" },
  { id: "learn", route: "/api/winddown/study/?mode=learn" },
  { id: "review", route: "/api/winddown/study/?mode=review" },
  { id: "drill", route: "/api/winddown/drill/" },
] as const;

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

function hasAdminGate(source: string) {
  return source.includes("ADMIN_SESSION_COOKIE")
    && source.includes("verifyAdminSessionToken")
    && source.includes("AdminAccessGate");
}

function noPostHandler(source: string) {
  return !source.includes("export async function POST");
}

function sourceChecks(): Check[] {
  const checks: Check[] = [];

  for (const route of ROUTES) {
    const page = readRel(route.page);
    checks.push(check(
      `source-${route.id}-route`,
      hasAdminGate(page) && page.includes(route.clientSymbol) ? "PASS" : "FAIL",
      `${route.route} is admin-gated and renders ${route.clientSymbol}`,
    ));
  }

  const productContract = readRel("src/features/winddown/model/productContract.ts");
  checks.push(check(
    "source-product-mode-graph",
    ["learn", "review", "drill", "roleplay", "live-talk"].every(
      (mode) => productContract.includes(`"${mode}"`),
    ) ? "PASS" : "FAIL",
    "current product contract names Learn, Review, Drill, Roleplay, and Live Talk",
  ));

  const studyRoute = readRel("src/app/api/winddown/study/route.ts");
  const drillRoute = readRel("src/app/api/winddown/drill/route.ts");
  const habitRoute = readRel("src/app/api/winddown/habit/route.ts");
  checks.push(check(
    "source-read-bootstrap-boundary",
    studyRoute.includes("export async function GET")
      && drillRoute.includes("export async function GET")
      && habitRoute.includes("export async function GET")
      && noPostHandler(studyRoute)
      && noPostHandler(drillRoute)
      && noPostHandler(habitRoute)
      ? "PASS"
      : "FAIL",
    "Learn, Review, Drill, and Home bootstrap APIs are GET-only",
  ));

  const progressRoute = readRel("src/app/api/winddown/progress/route.ts");
  const reviewRoute = readRel("src/app/api/winddown/review/route.ts");
  const ceremonyRoute = readRel("src/app/api/winddown/game/ceremony/route.ts");
  const voiceSessionRoute = readRel("src/app/api/winddown/live/session/route.ts");
  const voiceReportRoute = readRel("src/app/api/winddown/live/report/route.ts");
  checks.push(check(
    "source-write-boundary",
    [progressRoute, reviewRoute, ceremonyRoute, voiceSessionRoute, voiceReportRoute].every(
      (source) => source.includes("export async function POST"),
    ) ? "PASS" : "FAIL",
    "all learning, game, voice-session, and voice-report mutations remain POST-only",
  ));

  const learnClient = readRel("src/features/winddown/ui/WindDownLearnClient.tsx");
  const reviewClient = readRel("src/features/winddown/ui/WindDownReviewClient.tsx");
  const drillClient = readRel("src/features/winddown/drill/ui/WindDownDrillClient.tsx");
  const voiceClient = readRel("src/features/winddown/voice/ui/WindDownVoiceClient.tsx");
  checks.push(check(
    "source-client-bootstrap-graph",
    learnClient.includes("/api/winddown/study?mode=learn")
      && reviewClient.includes("/api/winddown/study?mode=review")
      && drillClient.includes("/api/winddown/drill")
      && voiceClient.includes("onClick={start}")
      ? "PASS"
      : "FAIL",
    "Learn, Review, and Drill bootstrap on GET; voice sessions begin only from an explicit start control",
  ));

  return checks;
}

function existingSessionCookie() {
  const value = process.env.QA_ADMIN_SESSION_COOKIE?.trim() ?? "";
  if (!value) return "";
  return value.includes("=") ? value : `fenok_admin_session=${value}`;
}

function requestHeaders(cookie: string) {
  return cookie ? { Cookie: cookie, "Cache-Control": "no-cache, no-store" } : { "Cache-Control": "no-cache, no-store" };
}

async function getBoundary(base: URL, route: string, cookie: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(new URL(route, base), {
      method: "GET",
      headers: requestHeaders(cookie),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function liveChecks(): Promise<Check[]> {
  if (sourceOnly) {
    return [check("live-http-boundaries", "WARN", "[not verified] skipped by --source-only")];
  }
  if (!baseUrl) {
    return [check("live-http-boundaries", "WARN", "[not verified] pass --base-url to run GET-only HTTP boundaries")];
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [check("live-http-boundaries", "FAIL", `invalid --base-url: ${baseUrl}`)];
  }

  const cookie = existingSessionCookie();
  const checks: Check[] = [];
  let authenticated = false;

  if (!cookie) {
    checks.push(check(
      "live-existing-session",
      "WARN",
      "[not verified] QA_ADMIN_SESSION_COOKIE is absent; no login request was attempted",
    ));
  } else {
    try {
      const response = await getBoundary(base, "/api/admin/session/", cookie);
      const payload = await response.json().catch(() => null) as { authenticated?: unknown } | null;
      authenticated = response.ok && payload?.authenticated === true;
      checks.push(check(
        "live-existing-session",
        authenticated ? "PASS" : "FAIL",
        authenticated
          ? "existing QA_ADMIN_SESSION_COOKIE authenticated by GET /api/admin/session/"
          : `existing QA_ADMIN_SESSION_COOKIE was rejected by GET /api/admin/session/ (HTTP ${response.status})`,
      ));
    } catch (error) {
      checks.push(check(
        "live-existing-session",
        "FAIL",
        `GET /api/admin/session/ failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }

  for (const route of ROUTES) {
    try {
      const response = await getBoundary(base, route.route, cookie);
      const status = response.status;
      const unavailable = status === 404;
      checks.push(check(
        `live-route-${route.id}`,
        unavailable ? "FAIL" : (authenticated ? (response.ok ? "PASS" : "FAIL") : "WARN"),
        authenticated
          ? `GET ${route.route} HTTP ${status}`
          : unavailable
            ? `GET ${route.route} HTTP 404; current source route is not available at this base URL`
            : `[not verified] GET ${route.route} HTTP ${status}; authenticated render was not proven`,
      ));
    } catch (error) {
      checks.push(check(
        `live-route-${route.id}`,
        authenticated ? "FAIL" : "WARN",
        `${authenticated ? "GET failed" : "[not verified] GET failed"} ${route.route}: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }

  for (const endpoint of READ_BOOTSTRAPS) {
    try {
      const response = await getBoundary(base, endpoint.route, cookie);
      const expected = authenticated ? 200 : 401;
      checks.push(check(
        `live-read-${endpoint.id}`,
        response.status === expected ? "PASS" : "FAIL",
        `GET ${endpoint.route} HTTP ${response.status}; expected ${expected} without any mutation request`,
      ));
    } catch (error) {
      checks.push(check(
        `live-read-${endpoint.id}`,
        "FAIL",
        `GET ${endpoint.route} failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }

  return checks;
}

function physicalChecks(): Check[] {
  return [
    check("physical-microphone", "WARN", "[not verified] GET-only preflight never requests microphone permission"),
    check("physical-iphone-stt", "WARN", "[not verified] requires an actual iPhone Safari speech-recognition check"),
    check("physical-gemini-live", "WARN", "[not verified] GET-only preflight never mints a Gemini token or opens a WebSocket"),
    check("physical-background-resume", "WARN", "[not verified] requires device background/resume observation; no voice report is submitted"),
  ];
}

async function main() {
  const checks = [
    ...sourceChecks(),
    ...(await liveChecks()),
    ...physicalChecks(),
  ];
  for (const item of checks) {
    console.log(`${item.status} ${item.id} - ${item.detail}`);
  }
  if (checks.some((item) => item.status === "FAIL")) process.exitCode = 1;
}

void main();
