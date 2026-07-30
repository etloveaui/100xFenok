import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const clientPath = path.join(
  process.cwd(),
  "src/features/winddown/ui/WindDownLearnClient.tsx",
);
const pagePath = path.join(process.cwd(), "src/app/winddown/learn/page.tsx");
const progressRoutePath = path.join(
  process.cwd(),
  "src/app/api/winddown/progress/route.ts",
);

const client = readFileSync(clientPath, "utf8");
const page = readFileSync(pagePath, "utf8");
const progressRoute = readFileSync(progressRoutePath, "utf8");

assert.ok(
  client.includes(
    "/api/winddown/study?mode=learn&count=${WINDDOWN_LEARN_CREDIT_TARGET}",
  ),
  "Learn UI must load exactly five model-free study cards",
);
assert.ok(
  client.includes('fetch("/api/winddown/progress"'),
  "credited Learn actions must use the dedicated progress endpoint",
);
assert.ok(
  client.includes("body?.persisted !== true"),
  "Learn UI must not advance past an unconfirmed persistence response",
);
assert.ok(
  client.includes("result.reward === 1"),
  "only credited reducer actions may create progress writes",
);
assert.ok(
  client.includes('feedback.outcome === "miss"'),
  "a miss needs an explicit learner-facing retry state",
);
assert.ok(
  client.includes("session.completion?.mistakeRecap"),
  "completion must render the reducer's mistake recap",
);
assert.ok(
  page.includes("verifyAdminSessionToken") &&
    page.includes("<AdminAccessGate />"),
  "the Learn route must retain the product authentication gate",
);
assert.ok(
  progressRoute.includes("ADMIN_SESSION_REQUIRED") &&
    progressRoute.includes("prepareWindDownLearnProgress"),
  "the progress endpoint must authenticate and validate writes",
);

for (const forbidden of [
  "MonaVoiceCoachApp",
  "useGeminiLiveSession",
  "/api/mona-vnext/session",
  "getUserMedia",
  "WebSocket",
]) {
  assert.equal(
    `${client}\n${page}\n${progressRoute}`.includes(forbidden),
    false,
    `model-free Learn surface reaches forbidden dependency: ${forbidden}`,
  );
}

console.log(
  "PASS winddown-learn-ui - five-card UI persists only credited model-free actions",
);
