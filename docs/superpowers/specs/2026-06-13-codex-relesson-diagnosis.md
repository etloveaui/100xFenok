# 2026-06-13 Mona Re-Lesson Diagnosis

Status: diagnostic note only. No runtime fix is applied here.

## Verdict

The "total-review hijack" diagnosis is real as a latent/post-save bug, but it is not sufficient as the root cause of the 2026-06-13 morning session.

Measured evidence says:

- At post-session state, `buildMonaCoachDynamicBlockV2("2026-06-13")` does fall into legacy total-review because there are now 5 session files and `review-meta.json` is missing.
- At likely session-start state, before `sessions/2026-06-13.json` existed, the same V2 builder does not fall into total review. It emits the V2 7-minute lesson for two new Saturday/free items.
- The actual voice log starts with those two new items, then saves the session early, then user requests "next/more", then the coach calls memory and regresses into the 2026-06-11 hard review trio.

So the failure is a combination:

1. Latent total-review gate: missing `review-meta.json` plus `sessions.length >= 5` makes the next prompt a legacy total-review prompt.
2. Mid-session request handling: "next/more" is not treated as "give me more new material"; it falls back through memory/review behavior.
3. Poisoned review pool: 2026-06-11 `can tell` and `at least 10` items still dominate `best3`, `weak-notes`, learner profile, and curriculum focus.

## Evidence

### 1. The total-review trigger is simple and brittle

`isTotalReviewDay` returns total review when there is no review metadata and the snapshot has at least five sessions:

- `100xfenok-next/src/lib/server/mona-study-tools.ts:563-568`

`buildMonaCoachDynamicBlockV2` computes that flag and, when true, returns the legacy block:

- `100xfenok-next/src/lib/server/mona-study-tools.ts:1274-1284`

The legacy block is where the total-review instruction is emitted:

- `100xfenok-next/src/lib/server/mona-study-tools.ts:1341-1395`

The live setup prepends this dynamic block to the model system prompt:

- `100xfenok-next/src/lib/server/admin-live.ts:228-232`

### 2. Why 2026-06-13 becomes total-review after the morning save

There is no `100xfenok-next/data/mona-english/review-meta.json` in the current data directory.

There are five session files after the 2026-06-13 morning session:

- `2026-06-09`
- `2026-06-10`
- `2026-06-11`
- `2026-06-12`
- `2026-06-13`

Measured post-session render:

```json
{
  "sessions": ["2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13"],
  "sessionCount": 5,
  "reviewMetaExists": false,
  "includesTotal": true,
  "includesLesson": false,
  "includesR1": false
}
```

The rendered post-session block includes:

```text
테마: 종합 복습
[종합 복습]
16개로 본다. 새로 만들지 마.
```

That means the next Mona session is currently at risk of starting in legacy total-review mode.

### 3. But that does not prove R1 was bypassed at the start of this session

The 2026-06-13 session file was saved at `2026-06-13T01:50:07.286Z`:

- `100xfenok-next/data/mona-english/sessions/2026-06-13.json:18`

The voice log started earlier, at `2026-06-13T01:48:20.399Z`, and only writes the session at seq 35:

- `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:251`

When I reproduced the start-state by excluding the newly saved 2026-06-13 session, the builder emitted V2 lesson mode:

```json
{
  "sessions": ["2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"],
  "sessionCount": 4,
  "includesTotal": false,
  "includesLesson": true,
  "includesR1": false
}
```

The start-state block contained:

```text
[7분 수업 - 기본문장 2개. 아래 LessonPlan에 있는 문장만 사용한다. 새 문장을 만들지 마]
문장1: 정말 부지런하네요. -> You're very industrious.
문장2: 뭐 볼 만한 거 있어? -> Is there anything good on?
```

The actual voice log confirms that the coach began with those two new items:

- `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:97`
- `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:202`

Therefore: the current evidence does not support "R1 never ran this morning" as a complete explanation. It supports "after the early save, the session fell back into memory/review behavior; after the session, future starts will be total-review unless fixed."

### 4. The hard trio is still in the review pool

2026-06-11 session created the hard trio:

- `You can tell just by tasting it.`
- `I can tell just by the design.`
- `I need at least 10.`

Evidence:

- `100xfenok-next/data/mona-english/sessions/2026-06-11.json:4-20`
- `100xfenok-next/data/mona-english/sessions/2026-06-11.json:21-40`

2026-06-12 re-saved `I need at least 10.` into BEST3:

- `100xfenok-next/data/mona-english/sessions/2026-06-12.json:15-23`

Current `best3.json` still contains:

- `I need at least 10.` with box 4 and due `2026-06-26`: `100xfenok-next/data/mona-english/best3.json:29-40`
- `You can tell just by tasting it.` with box 4 and due `2026-06-26`: `100xfenok-next/data/mona-english/best3.json:79-89`
- `I can tell just by the design.` with box 1 and no due date: `100xfenok-next/data/mona-english/best3.json:117-127`

Current `weak-notes.json` still contains:

- `I need at least 10.`: `100xfenok-next/data/mona-english/weak-notes.json:5-18`
- `I can tell just by the design.`: `100xfenok-next/data/mona-english/weak-notes.json:20-33`
- `You can tell just by tasting it.`: `100xfenok-next/data/mona-english/weak-notes.json:35-48`

The current learner profile and curriculum also keep pointing to `can tell just by ~`:

- `100xfenok-next/data/mona-english/profile/learner-profile.json`
- `100xfenok-next/data/mona-english/curriculum-live.json`

### 5. The failure moment in the live log

The user asks to continue:

- `다음가 해줘.` at seq 39: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:279`
- `더 해 줘.` at seq 56: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:398`

The coach responds by calling memory:

- `getStudyMemory` after the first request: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:293`
- `getStudyMemory` after the second request: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:405`

Then it replays the old hard items:

- `I can tell just by the design.` review: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:475-482`
- `I need at least ten.` / `I need at least 10.` review: `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:433` and `100xfenok-next/data/voice-logs/2026-06-13_mona_live-mona-mqbp4vtu.json:496`

This is not just "old total-review prompt". It is also a live-control failure: the coach had no strong rule saying user meta-requests like "new", "more", "next", "again", "easier", "harder" override the current memory/review plan.

## Architecture Recommendation

Do not add more rigid state-machine enforcement as the main fix.

The problem is not that the state machine lacked one more guard. The problem is that rigid server-decided modes can contradict the live learner's explicit request. Adding R2/R3 enforcement on top of this would likely make the coach more railroaded, not more helpful.

Recommended direction:

1. Replace hard total-review override with a soft suggestion.
   - Total review may seed material, but it must not bypass V2 lesson mode.
   - In V2, total-review should become a `reviewBias` or `reviewBudget`, not a full legacy prompt.

2. Add explicit live meta-request handling.
   - "새로운 거", "더 해줘", "다음 거" => continue with unused new LessonPlan/expression-bank items first.
   - "다시", "복습", "아까 거" => use review items.
   - "쉬운 거" => switch to sibling/easier item.
   - "어려운 거" => use variation/drill or a higher difficulty item.
   - "그만", "끝" => close and save.

3. Make memory tools request-aware.
   - `getStudyMemory({ intent: "new" })` should not return weak-note/best3 review material as the dominant answer.
   - Add a separate `getNextLessonItem` or `mona-next-lesson-item` tool that draws from remaining V2 lesson items or expression bank, excluding already completed items in this session.

4. Keep a minimal state machine only for safety and bookkeeping.
   - Track current item, completed items, saved checkpoints, and active request intent.
   - Do not let it decide the pedagogical plan against the student's explicit request.

5. Quarantine the 2026-06-11 hard trio from "new/more" flows.
   - They can remain valid review material.
   - They should not appear unless the user asks for review or the coach explicitly asks for consent before review.

## Concrete Fix Shape

Lowest-risk patch sequence:

1. In `buildMonaCoachDynamicBlockV2`, remove the early `if (totalReview) return buildMonaCoachDynamicBlock(...)`.
2. Keep V2 lesson rendering and add a small total-review note only when total review is due.
3. Add a high-priority instruction above pacing:
   - If Mona asks for new/more/next, continue with unused new material before review.
   - Ask one short clarification only if the request is ambiguous.
4. Add a test that 5 existing sessions with missing review-meta still produce V2 lesson block, not legacy total-review.
5. Add a test/fixture for "more/new" meta-request policy text in the dynamic block.
6. Add a data hygiene note or quarantine list for the 2026-06-11 hard trio in new-material flows.

## Answer to the Three Questions

1. Why did `isTotalReviewDay` trigger on 2026-06-13?
   - It triggers when `review-meta.json` is missing and `snapshot.sessions.length >= 5`. After the 2026-06-13 save, the snapshot has five sessions. Before that save, likely only four sessions were present.

2. Is total-review hijack the root cause?
   - It is a real post-save/next-session root cause, but not enough to explain the observed start of the 06-13 session. The actual session began with V2 new items, then regressed after save/memory calls. The review pool is also contaminated by the 06-11 hard trio.

3. Remove rigid overrides or add more state-machine enforcement?
   - Remove rigid pedagogical overrides. Keep only a thin state machine for safety/bookkeeping. The coach must treat live learner requests as first-class control input.
