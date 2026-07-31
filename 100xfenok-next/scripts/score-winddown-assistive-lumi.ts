import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WIND_DOWN_IDLE_ASSIST_DELAY_MS,
  firstEnglishLetter,
  firstWrongChoiceId,
} from "../src/features/winddown/ui/windDownAssistiveHints";

assert.equal(
  WIND_DOWN_IDLE_ASSIST_DELAY_MS,
  2_600,
  "idle assistance must wait about 2.6 seconds",
);
assert.equal(
  firstWrongChoiceId(
    [{ id: "correct" }, { id: "wrong-one" }, { id: "wrong-two" }],
    "correct",
  ),
  "wrong-one",
  "meaning hint must deterministically dim the first rendered wrong choice",
);
assert.equal(firstWrongChoiceId([{ id: "correct" }], "correct"), null);
assert.equal(firstEnglishLetter("  “I am ready.”"), "I");
assert.equal(firstEnglishLetter("..."), null);

const learn = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownLearnClient.tsx"),
  "utf8",
);
const review = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownReviewClient.tsx"),
  "utf8",
);
for (const source of [learn, review]) {
  assert.ok(
    source.includes("WIND_DOWN_IDLE_ASSIST_DELAY_MS")
      && source.includes("window.setTimeout")
      && source.includes("window.clearTimeout"),
    "an assistive cue must be cancellable and wait for the shared idle delay",
  );
}
assert.ok(
  learn.includes("firstWrongChoiceId")
    && learn.includes("opacity-40")
    && learn.includes("canonicalTokenIds[0]")
    && learn.includes("animate-pulse")
    && learn.includes("motion-reduce:animate-none"),
  "Learn must dim one wrong meaning choice or pulse the first canonical token accessibly",
);
assert.ok(
  review.includes("session?.phase === \"recall\"")
    && review.includes("!answer.trim()")
    && review.includes("firstEnglishLetter")
    && review.includes("루미 힌트: 첫 글자는"),
  "Review must reveal a first-letter cue only for an empty initial recall",
);
assert.equal(
  review.includes("revealedBefore: true"),
  false,
  "the idle first-letter cue must not change the existing full-reveal progress record",
);

console.log("winddown assistive Lumi scorer: PASS");
