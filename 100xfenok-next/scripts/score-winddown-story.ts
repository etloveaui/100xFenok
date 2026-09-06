import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { getWindDownVoiceScenario, evaluateWindDownRoleplay } from '../src/features/winddown/voice/product';
import { WIND_DOWN_CHAPTERS } from '../src/features/winddown/game/model/tour';

async function main() {
const scenarioIds = ['artist-audition', 'team-rehearsal', 'fan-meeting', 'artist-interview', 'creative-repair', 'acceptance-speech'];
for (const id of scenarioIds) {
  const scenario = getWindDownVoiceScenario(id);
  assert.ok(scenario, `Artist situation ${id} must resolve to a real server-owned voice scenario`);
  assert.equal(scenario.goals.length, 3);
  assert.ok(scenario.openingLine.length > 15);
}
assert.ok(getWindDownVoiceScenario('cafe-order'));
assert.ok(getWindDownVoiceScenario('after-work-check-in'));
assert.equal(getWindDownVoiceScenario('arbitrary-browser-prompt'), null);
assert.ok(existsSync('src/features/winddown/game/model/story.ts'), 'Artist career needs an additive authored story catalog');
const story = await import('../src/features/winddown/game/model/story');
const episodes = story.WIND_DOWN_STORY_EPISODES;
assert.equal(new Set(episodes.map((e) => e.id)).size, episodes.length, 'Episode identities must be unique');
assert.ok(episodes.length > WIND_DOWN_CHAPTERS.length, 'New episodes must extend rather than rename the legacy tour');
for (const chapter of WIND_DOWN_CHAPTERS) {
  const rows = story.storyEpisodesForChapter(chapter.id);
  assert.ok(rows.length, `Legacy chapter ${chapter.id} needs authored story`);
  for (const episode of rows) {
    assert.equal(story.storyEpisodeById(episode.id), episode);
    for (const text of [episode.title, episode.location, episode.setup, episode.dialogue, episode.objective, episode.englishExample, episode.reflection]) assert.ok(text.trim().length > 2);
    assert.ok(['luna', 'nova', 'sol', 'mira'].includes(episode.guide));
    const scenario = getWindDownVoiceScenario(episode.scenarioId);
    assert.ok(scenario);
    const exampleEvidence = evaluateWindDownRoleplay(scenario, [{ conversationId: 'story-example', turnSeq: 1, userText: episode.englishExample, modelText: 'Thanks for sharing.', finalized: true, sttDrift: false, interrupted: false }]);
    assert.ok(exampleEvidence.evidence.length > 0, `${episode.id} example must support an actual authored expression marker`);
    const href = new URL(story.storyRoleplayHref(episode), 'https://local.invalid');
    assert.equal(href.pathname, '/winddown/roleplay');
    assert.equal(href.searchParams.get('story'), episode.id);
    assert.equal(href.searchParams.get('scenario'), episode.scenarioId);
    assert.equal(story.storyEpisodeState(episode, 1698) === 'preview', false, 'Previously unlocked progress must remain accessible');
    if (chapter.id !== 'practice') assert.equal(story.storyEpisodeState(episode, 0), 'preview');
  }
}
assert.equal(story.storyEpisodeById('../../admin'), null);
assert.deepEqual(story.storyEpisodesForChapter('unknown'), []);
for (const id of ['coachella', 'korea-number-one', 'asia-number-one', 'north-america-number-one', 'homecoming']) assert.ok(story.storyEpisodeById(id), `Distinct career episode ${id} is required`);
assert.equal(story.storyEpisodeById('coachella')?.sceneKey, 'coachella');
assert.equal(story.storyEpisodeById('homecoming')?.sceneKey, 'epilogue');
const game = readFileSync('src/features/winddown/game/ui/WindDownGameClient.tsx', 'utf8');
assert.equal(game.includes('requestAnimationFrame'), false, 'Static story scenes must not retain continuous canvas redraw');
assert.equal(game.includes('paintScene'), false, 'The approved illustrated stage replaces the primitive painter');
assert.ok(game.includes('WindDownStoryScene'), 'Game consumes the responsive illustrated scene');
console.log(`WIND DOWN story PASS: ${episodes.length} episodes, 24 legacy anchors, 6 authored situation families`);

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
