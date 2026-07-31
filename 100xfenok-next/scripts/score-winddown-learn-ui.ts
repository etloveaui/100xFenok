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
  client.includes("/api/winddown/study?mode=learn&seed=")
    && !client.includes("&count=")
    && client.includes("body.cards.length !== WINDDOWN_LEARN_CREDIT_TARGET"),
  "Learn UI must rely on the server-owned five-card contract and reject any mismatch",
);
assert.ok(
  client.includes('fetch("/api/winddown/progress"'),
  "every Learn action must use the dedicated progress endpoint",
);
assert.ok(
  client.includes("body?.persisted !== true"),
  "Learn UI must not advance past an unconfirmed persistence response",
);
assert.ok(
  client.includes("sessionProof") &&
    client.includes("action,"),
  "the client must submit the signed session proof and actual action, not a self-awarded verdict",
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
  client.includes('href="/winddown/roleplay"') &&
    client.includes("다음: 말하기"),
  "Learn completion must offer the next journey step directly",
);
assert.ok(
  page.includes("verifyAdminSessionToken") &&
    page.includes("<AdminAccessGate />"),
  "the Learn route must retain the product authentication gate",
);
assert.ok(
  progressRoute.includes("ADMIN_SESSION_REQUIRED") &&
    progressRoute.includes("verifyWindDownLearnSessionProof") &&
    progressRoute.includes("commitWindDownLearnAttemptThroughCoordinator"),
  "the progress endpoint must authenticate, verify the server proof, and commit through the coordinator",
);
for (const forbiddenTrustField of ["occurredAt", "verdict:", "sequence:"]) {
  assert.equal(
    client.includes(forbiddenTrustField),
    false,
    `the Learn client must not award its own ${forbiddenTrustField}`,
  );
}

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
  "PASS winddown-learn-ui - five-card UI submits signed actions and resumes server state",
);
