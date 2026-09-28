import assert from "node:assert/strict";
import {
  WIND_DOWN_VOICE_POLICY_VERSION,
  WINDDOWN_VOICE_SCENARIOS,
  evaluateWindDownRoleplay,
  getWindDownVoiceScenario,
  isWindDownVoiceDescriptor,
  isWindDownVoiceScenarioId,
  type WindDownVoiceFinalizedTurn,
  type WindDownVoiceScenario,
} from "../src/features/winddown/voice/product";

type ArtistScenarioFixture = {
  id: string;
  sceneMarkers: readonly string[];
  coachMarkers: readonly string[];
  openingMarkers: readonly string[];
  positives: readonly [string, string, string];
  negatives: readonly [string, string, string];
  wrongTopic: string;
};

const ARTIST_SCENARIO_FIXTURES: readonly ArtistScenarioFixture[] = [
  {
    id: "artist-audition",
    sceneMarkers: ["오디션", "룸"],
    coachMarkers: ["singer", "audition"],
    openingMarkers: ["audition room", "yourself"],
    positives: [
      "I am a vocalist on this team tonight.",
      "I want to inspire people with our music.",
      "Could you repeat that part of the question?",
    ],
    negatives: [
      "The vocalist is waiting outside, but I stayed silent.",
      "Inspiration matters, but I have no goal for tonight.",
      "The question was repeated already, so I will wait.",
    ],
    wrongTopic: "Thanks for supporting us through every rehearsal.",
  },
  {
    id: "team-rehearsal",
    sceneMarkers: ["리허설", "후렴구"],
    coachMarkers: ["bandmate", "rehearsal"],
    openingMarkers: ["rehearsal", "next take"],
    positives: [
      "Let's rehearse the chorus again before dinner.",
      "Because timing needs work, we should slow down.",
      "That makes sense to me; I can count us in.",
    ],
    negatives: [
      "The chorus is ready, but we will not rehearse it.",
      "The timing is fine, and we can leave now.",
      "Your idea is on the board, but I have no response.",
    ],
    wrongTopic: "Could you repeat that part of the question?",
  },
  {
    id: "fan-meeting",
    sceneMarkers: ["팬", "미팅"],
    coachMarkers: ["fan", "meeting"],
    openingMarkers: ["signed album", "fan"],
    positives: [
      "It is nice to meet you at the fan event.",
      "My favorite song is Starlight because it feels like home.",
      "Thanks for supporting us through every rehearsal.",
    ],
    negatives: [
      "The meeting is over, and I saw the guest.",
      "The song title is on the album, but I will not explain it.",
      "Support helps artists, but I did not thank anyone.",
    ],
    wrongTopic: "Our new song tells a story about courage.",
  },
  {
    id: "artist-interview",
    sceneMarkers: ["인터뷰", "방송"],
    coachMarkers: ["artist", "press"],
    openingMarkers: ["interview", "people"],
    positives: [
      "Our new song tells a story about courage.",
      "For example, our chorus grew from rehearsal.",
      "Do you mean the writing process for this song?",
    ],
    negatives: [
      "The new song is playing quietly in the studio.",
      "The chorus grew last year, but I will not give an example.",
      "The question is clear, and I will answer later.",
    ],
    wrongTopic: "Let's test both endings during rehearsal tonight.",
  },
  {
    id: "creative-repair",
    sceneMarkers: ["앙코르", "백스테이지"],
    coachMarkers: ["creative", "partner"],
    openingMarkers: ["encore", "ending"],
    positives: [
      "I prefer a quiet ending for the encore.",
      "I understand your idea about the final chorus.",
      "Let's test both endings during rehearsal tonight.",
    ],
    negatives: [
      "I have a preference, but I will not choose an ending.",
      "Your idea is on the board, and I saw it.",
      "We can discuss rehearsal another day.",
    ],
    wrongTopic: "Where is the concert hall for tonight's show?",
  },
  {
    id: "acceptance-speech",
    sceneMarkers: ["시상식", "성장"],
    coachMarkers: ["award", "producer"],
    openingMarkers: ["ceremony", "means"],
    positives: [
      "This award means a lot to our team.",
      "I want to thank our team for believing in us.",
      "I hope we inspire others through our music.",
    ],
    negatives: [
      "The award is heavy, but I will put it down.",
      "Our team is waiting backstage, and I waved.",
      "Practice was long, so I went home.",
    ],
    wrongTopic: "We have grown so much since our first rehearsal.",
  },
  {
    id: "tour-arrival",
    sceneMarkers: ["공연장", "콘서트홀"],
    coachMarkers: ["venue", "assistant"],
    openingMarkers: ["venue", "concert hall"],
    positives: [
      "Excuse me, where is the concert hall for tonight?",
      "Could you repeat those directions so I can find it?",
      "Thank you for your help today.",
    ],
    negatives: [
      "The concert hall is closed for a rehearsal.",
      "I heard directions on the sign, but no turn is clear.",
      "Your help was useful, but I forgot to thank you.",
    ],
    wrongTopic: "Welcome to our show tonight, everyone.",
  },
  {
    id: "festival-audience",
    sceneMarkers: ["축제", "관객"],
    coachMarkers: ["festival", "coach"],
    openingMarkers: ["crowd", "song"],
    positives: [
      "Welcome to our show tonight, everyone.",
      "This song is about finding courage and hope.",
      "Please sing along with us tonight.",
    ],
    negatives: [
      "The welcome sign is behind the stage.",
      "I know the song title, but not its story.",
      "The audience can sing, but I will watch.",
    ],
    wrongTopic: "I hope to keep learning with the team.",
  },
  {
    id: "career-reflection",
    sceneMarkers: ["연습실", "성장"],
    coachMarkers: ["bandmate", "reflection"],
    openingMarkers: ["journey", "learned"],
    positives: [
      "We have grown so much since our first rehearsal.",
      "Thank you for standing by me through every change.",
      "I hope to keep learning with the team.",
    ],
    negatives: [
      "Growth takes time, and I am still thinking.",
      "The team is nearby, but I said nothing.",
      "The future feels uncertain, so I will wait.",
    ],
    wrongTopic: "This award means a lot to our team.",
  },
] as const;

const LEGACY_SCENARIO_FIXTURES = {
  "cafe-order": {
    title: "카페에서 주문하기",
    scene: "루미는 바리스타예요. 음료를 주문하고, 취향을 말하고, 자연스럽게 마무리해봐요.",
    coachRole: "friendly cafe barista",
    openingLine: "Hi! What can I get for you tonight?",
    goals: [
      { id: "order", label: "음료를 주문했어", matchAny: ["i'd like", "i would like", "can i get", "could i get", "i'll have"] },
      { id: "preference", label: "내 취향을 말했어", matchAny: ["with oat milk", "with soy milk", "without ice", "less sweet", "decaf"] },
      { id: "close", label: "주문을 마무리했어", matchAny: ["that's all", "that will be all", "thank you", "thanks"] },
    ],
  },
  "after-work-check-in": {
    title: "퇴근 후 안부",
    scene: "루미는 하루를 함께 정리하는 친구예요. 오늘의 기분과 이유, 내일의 작은 계획을 말해봐요.",
    coachRole: "warm after-work friend",
    openingLine: "How did your day go?",
    goals: [
      { id: "feeling", label: "오늘의 기분을 말했어", matchAny: ["i feel", "i felt", "i'm feeling", "i was"] },
      { id: "reason", label: "이유를 덧붙였어", matchAny: ["because", "since", "so", "it was"] },
      { id: "next-step", label: "내일의 작은 계획을 말했어", matchAny: ["tomorrow i'll", "tomorrow i will", "i'm going to", "i want to"] },
    ],
  },
} as const;

function cleanTurn(
  conversationId: string,
  turnSeq: number,
  userText: string | null,
  overrides: Partial<WindDownVoiceFinalizedTurn> = {},
): WindDownVoiceFinalizedTurn {
  return {
    conversationId,
    turnSeq,
    userText,
    modelText: "Thanks for sharing that.",
    finalized: true,
    sttDrift: false,
    interrupted: false,
    ...overrides,
  };
}

function scenarioOrFail(id: string): WindDownVoiceScenario {
  const scenario = getWindDownVoiceScenario(id);
  assert.ok(scenario, `server catalog must resolve ${id}`);
  return scenario;
}

function includesMarker(value: string, marker: string) {
  return value.toLocaleLowerCase("en-US").includes(marker.toLocaleLowerCase("en-US"));
}

function normalizeForFixture(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function assertScenarioMetadata(
  scenario: WindDownVoiceScenario,
  fixture: ArtistScenarioFixture,
) {
  assert.equal(scenario.id, fixture.id);
  assert.equal(scenario.version, WIND_DOWN_VOICE_POLICY_VERSION);
  assert.ok(scenario.title.trim().length >= 4, `${fixture.id} needs a concrete title`);
  assert.ok(scenario.scene.trim().length >= 24, `${fixture.id} needs an authored setting`);
  assert.ok(scenario.coachRole.trim().length >= 12, `${fixture.id} needs an authored coach role`);
  assert.ok(scenario.openingLine.trim().length >= 24, `${fixture.id} needs an authored opening`);
  for (const marker of fixture.sceneMarkers) {
    assert.equal(
      includesMarker(scenario.scene, marker),
      true,
      `${fixture.id} scene must retain the authored setting marker ${marker}`,
    );
  }
  for (const marker of fixture.coachMarkers) {
    assert.equal(
      includesMarker(scenario.coachRole, marker),
      true,
      `${fixture.id} coach role must retain the authored marker ${marker}`,
    );
  }
  for (const marker of fixture.openingMarkers) {
    assert.equal(
      includesMarker(scenario.openingLine, marker),
      true,
      `${fixture.id} opening must retain the authored marker ${marker}`,
    );
  }
  assert.equal(scenario.goals.length, 3, `${fixture.id} must have exactly three goals`);
  for (const goal of scenario.goals) {
    assert.ok(goal.id.trim(), `${fixture.id} goal id must be authored`);
    assert.ok(goal.label.trim(), `${fixture.id} goal label must be authored`);
    assert.ok(goal.label.startsWith("표현 힌트:"), `${fixture.id} labels must be expression hints`);
    assert.ok(goal.matchAny.length >= 2, `${fixture.id} goal needs phrase variants`);
    for (const phrase of goal.matchAny) {
      assert.ok(phrase.trim(), `${fixture.id} has an empty accepted phrase`);
      assert.ok(
        phrase.trim().split(/\s+/).length >= 3 && phrase.trim().split(/\s+/).length <= 6,
        `${fixture.id} accepted evidence must be a reusable 3–6 word phrase, not a topic word or script`,
      );
    }
  }
  assert.equal(
    scenario.eyebrow.includes("ROLEPLAY"),
    true,
    `${fixture.id} must be presented as roleplay`,
  );
  assert.equal(
    scenario.eyebrow.includes("EXPRESSION MARKERS"),
    true,
    `${fixture.id} goals must be presented as practice expression markers`,
  );
}

function assertCleanPositiveEvidence(
  scenario: WindDownVoiceScenario,
  fixture: ArtistScenarioFixture,
) {
  const progress = evaluateWindDownRoleplay(
    scenario,
    fixture.positives.map((text, index) => cleanTurn(`${fixture.id}-positive`, index + 1, text)),
  );
  assert.equal(progress.completed, true, `${fixture.id} clean phrases complete all goals`);
  assert.deepEqual(
    progress.completedGoalIds,
    scenario.goals.map((goal) => goal.id),
  );
  assert.equal(progress.evidence.length, 3);
  for (const [index, evidence] of progress.evidence.entries()) {
    assert.equal(evidence.scenarioId, fixture.id);
    assert.equal(evidence.turnSeq, index + 1);
    assert.equal(evidence.learnerText, fixture.positives[index]);
    assert.ok(evidence.matchedPhrase.trim().split(/\s+/).length >= 3);
    assert.notEqual(
      normalizeForFixture(evidence.learnerText),
      normalizeForFixture(evidence.matchedPhrase),
      `${fixture.id} positive should include meaningful context around its expression hint`,
    );
  }
}

function assertNegativeEvidence(
  scenario: WindDownVoiceScenario,
  fixture: ArtistScenarioFixture,
) {
  const progress = evaluateWindDownRoleplay(
    scenario,
    fixture.negatives.map((text, index) => cleanTurn(`${fixture.id}-negative`, index + 1, text)),
  );
  assert.equal(progress.completed, false, `${fixture.id} keyword-only negatives cannot complete`);
  assert.deepEqual(progress.completedGoalIds, []);
  assert.deepEqual(progress.evidence, []);
}

function assertTranscriptSafety(
  scenario: WindDownVoiceScenario,
  fixture: ArtistScenarioFixture,
) {
  const variants: readonly [string, Partial<WindDownVoiceFinalizedTurn>][] = [
    ["interrupted", { interrupted: true }],
    ["drifted", { sttDrift: true }],
    ["partial", { finalized: false }],
    ["no-learner", { userText: null, modelText: fixture.positives[0] }],
    ["wrong-topic", { userText: fixture.wrongTopic }],
  ];
  for (const [name, overrides] of variants) {
    const turns = [
      cleanTurn(`${fixture.id}-${name}`, 1, fixture.positives[0], overrides),
      cleanTurn(`${fixture.id}-${name}`, 2, fixture.positives[1]),
      cleanTurn(`${fixture.id}-${name}`, 3, fixture.positives[2]),
    ];
    const progress = evaluateWindDownRoleplay(scenario, turns);
    assert.equal(progress.completed, false, `${fixture.id} ${name} turn cannot complete the scene`);
    assert.equal(
      progress.evidence.some((evidence) => evidence.goalId === scenario.goals[0].id),
      false,
      `${fixture.id} ${name} turn cannot create first-goal evidence`,
    );
  }
}

const ids = ARTIST_SCENARIO_FIXTURES.map((fixture) => fixture.id);
assert.deepEqual(ids, [
  "artist-audition",
  "team-rehearsal",
  "fan-meeting",
  "artist-interview",
  "creative-repair",
  "acceptance-speech",
  "tour-arrival",
  "festival-audience",
  "career-reflection",
]);
assert.equal(new Set(ids).size, ids.length, "artist scenario IDs must be unique");
assert.equal(
  WINDDOWN_VOICE_SCENARIOS.length,
  11,
  "the nine singer scenes must be additive to the two legacy scenes",
);

for (const fixture of ARTIST_SCENARIO_FIXTURES) {
  const scenario = scenarioOrFail(fixture.id);
  assertScenarioMetadata(scenario, fixture);
  assert.equal(isWindDownVoiceScenarioId(fixture.id), true);
  assert.equal(
    isWindDownVoiceDescriptor({
      activity: "roleplay",
      scenarioId: fixture.id,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    }),
    true,
    `${fixture.id} must be accepted by the strict roleplay descriptor guard`,
  );
  assertCleanPositiveEvidence(scenario, fixture);
  assertNegativeEvidence(scenario, fixture);
  assertTranscriptSafety(scenario, fixture);
}

for (const [id, expected] of Object.entries(LEGACY_SCENARIO_FIXTURES)) {
  const scenario = scenarioOrFail(id);
  assert.deepEqual(
    {
      title: scenario.title,
      scene: scenario.scene,
      coachRole: scenario.coachRole,
      openingLine: scenario.openingLine,
      goals: scenario.goals,
    },
    expected,
    `${id} semantics must remain unchanged`,
  );
}

assert.equal(
  isWindDownVoiceDescriptor({
    activity: "roleplay",
    scenarioId: "artist-audition",
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    setup: "browser-controlled prompt injection",
  }),
  false,
  "scenario descriptor must continue rejecting browser-owned fields",
);

console.log(
  `PASS winddown-artist-voice - ${ARTIST_SCENARIO_FIXTURES.length} authored singer scenes, bounded expression hints, keyword negatives, and clean-transcript gates`,
);
