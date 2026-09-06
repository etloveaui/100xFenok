/**
 * The authored career story that sits on top of the immutable WIND DOWN tour.
 *
 * Episodes are presentation and practice context only. Progress remains owned
 * by the existing chapter unlock projection, and roleplay remains owned by the
 * server-owned voice scenario catalog.
 */

import {
  currentChapter,
  isChapterUnlocked,
} from "@/features/winddown/game/model/progress";
import {
  WIND_DOWN_CHAPTERS,
  type WindDownChapter,
} from "@/features/winddown/game/model/tour";
import type { WindDownVoiceScenarioId } from "@/features/winddown/voice/product";

export type WindDownStoryGuide = "luna" | "nova" | "sol" | "mira";

export type WindDownStoryKeepsake = string;

export type WindDownStoryEpisode = {
  readonly id: string;
  /** Stable legacy chapter identity. Episodes never replace or rename it. */
  readonly chapterId: string;
  readonly title: string;
  readonly location: string;
  /** Key resolved by the lead-owned stage art manifest. */
  readonly sceneKey: string;
  readonly guide: WindDownStoryGuide;
  readonly setup: string;
  readonly dialogue: string;
  readonly objective: string;
  readonly englishExample: string;
  /** Server-owned voice scenario identity; never free-form prompt text. */
  readonly scenarioId: WindDownVoiceScenarioId;
  readonly reflection: string;
  readonly keepsake?: WindDownStoryKeepsake;
};

export type WindDownStoryEpisodeState = "current" | "replay" | "preview";

const episode = (
  value: WindDownStoryEpisode,
): WindDownStoryEpisode => value;

/**
 * Nine acts of a fictional singer career. Several chapters contain arrival,
 * public moment, and reflection beats so a quiet study night still advances
 * the relationship story without granting a new reward.
 */
export const WIND_DOWN_STORY_EPISODES: readonly WindDownStoryEpisode[] = [
  episode({
    id: "practice-first-note",
    chapterId: "practice",
    title: "첫 음을 내는 밤",
    location: "서울 · 아무도 모르는 연습실",
    sceneKey: "practice",
    guide: "luna",
    setup: "거울 앞에서 네 사람의 연습이 시작된다. 루나는 노트를 접고 네 옆에 선다.",
    dialogue: "루나: 이름과 꿈을 한 문장으로 말해볼래? 틀려도 오늘의 첫 음이 될 거야.",
    objective: "내 이름과 지금 이루고 싶은 일을 소개하고, 못 들었을 때 다시 말해 달라고 부탁해요.",
    englishExample: "I am a vocalist, and my goal is to become a singer who connects with people.",
    scenarioId: "artist-audition",
    reflection: "작은 목소리도 시작한 사람의 목소리야. 오늘 노트에 첫 줄을 남겼어.",
    keepsake: "첫 연습 노트",
  }),
  episode({
    id: "audition-number",
    chapterId: "audition",
    title: "번호표 뒤의 이름",
    location: "서울 · 오디션 대기실",
    sceneKey: "audition",
    guide: "nova",
    setup: "번호표가 손바닥에 땀을 남긴다. 노바가 문 쪽을 가리키며 웃는다.",
    dialogue: "노바: 우리 번호가 아니라 우리 이름으로 들어가자. 목표를 말할 준비 됐지?",
    objective: "내 역할과 목표를 또렷하게 말하고, 긴장될 때 도움을 요청해요.",
    englishExample: "I am a vocalist, and I want to inspire people through music.",
    scenarioId: "artist-audition",
    reflection: "문을 열었다는 사실이 결과보다 먼저 너를 바꿨어.",
    keepsake: "오디션 번호표",
  }),
  episode({
    id: "dorm-first-evening",
    chapterId: "dorm",
    title: "같이 사는 첫 저녁",
    location: "서울 · 네 사람의 합숙소",
    sceneKey: "dorm",
    guide: "mira",
    setup: "연습복과 컵이 한 테이블에 섞였다. 미라는 조심스럽게 네게 자리를 내준다.",
    dialogue: "미라: 우리 생활 시간이 조금 달라. 서로 도울 방법을 하나 정해볼까?",
    objective: "내 일과를 설명하고, 필요한 도움을 요청한 뒤 팀의 작은 계획을 제안해요.",
    englishExample: "Let's rehearse the chorus again before the next take because we need tighter timing.",
    scenarioId: "team-rehearsal",
    reflection: "혼자 잘하는 것보다 서로 맞추는 일이 팀의 첫 안무가 됐어.",
    keepsake: "합숙소의 공용 머그컵",
  }),
  episode({
    id: "dorm-rehearsal-plan",
    chapterId: "dorm",
    title: "잠들기 전의 약속",
    location: "서울 · 거실 바닥의 연습표",
    sceneKey: "dorm",
    guide: "sol",
    setup: "솔이 연습표의 빈칸을 두드린다. 모두의 피곤한 얼굴이 같은 방향을 본다.",
    dialogue: "솔: 오늘 전부 하려 하지 말자. 내일 먼저 맞출 한 부분과 이유를 정해.",
    objective: "한 가지 연습을 제안하고 이유를 말한 다음, 동료의 생각을 인정해요.",
    englishExample: "Let's rehearse the chorus again before the next take. I agree with your idea and I can help with the count.",
    scenarioId: "team-rehearsal",
    reflection: "속도를 늦추자는 말도 팀을 앞으로 보내는 리듬이 될 수 있어.",
  }),
  episode({
    id: "debut-lineup-reveal",
    chapterId: "reveal",
    title: "네 사람의 이름",
    location: "서울 · 데뷔조 발표실",
    sceneKey: "reveal",
    guide: "luna",
    setup: "화이트보드에 네 사람의 이름이 나란히 적힌다. 아직 무대는 없지만 방향은 생겼다.",
    dialogue: "루나: 이제 우리를 설명할 말이 필요해. 각자의 강점을 한 문장씩 모아보자.",
    objective: "내 강점과 팀의 목표를 소개하고, 다른 사람의 생각에 동의하거나 덧붙여요.",
    englishExample: "Let's rehearse the chorus again before the next take. I agree with your idea and I can help with the count.",
    scenarioId: "team-rehearsal",
    reflection: "네 목소리가 섞이자 연습생이라는 말이 팀의 이름으로 바뀌었어.",
    keepsake: "데뷔조 보드의 네 사람 이름",
  }),
  episode({
    id: "debut-song-promise",
    chapterId: "musicshow",
    title: "노래에 약속을 넣기",
    location: "서울 · 첫 방송 리허설실",
    sceneKey: "broadcast",
    guide: "sol",
    setup: "카메라가 아직 꺼져 있는데도 심장은 생방송처럼 뛴다. 솔이 후렴의 뜻을 묻는다.",
    dialogue: "솔: 이 노래를 처음 듣는 사람에게 무엇을 건넬 거야? 짧고 정확하게 말해보자.",
    objective: "노래의 의미를 설명하고, 질문을 잘 듣지 못했을 때 정중하게 확인해요.",
    englishExample: "Our new song tells a story about finding courage on the first stage. Could you clarify that?",
    scenarioId: "artist-interview",
    reflection: "가사는 외운 문장이 아니라 누군가에게 건네는 약속이 됐어.",
  }),
  episode({
    id: "first-broadcast-lights",
    chapterId: "musicshow",
    title: "빨간 불이 켜진 순간",
    location: "서울 · 첫 음악방송 무대",
    sceneKey: "broadcast",
    guide: "nova",
    setup: "카메라의 빨간 불이 켜진다. 노바가 손가락으로 네 박자를 세어준다.",
    dialogue: "노바: 떨려도 괜찮아. 첫 인사와 노래 한 줄이면 오늘 우리를 설명할 수 있어.",
    objective: "시청자에게 인사하고 노래를 한 문장으로 소개한 뒤 감사 인사를 전해요.",
    englishExample: "Our new song tells a story about courage between rehearsals. One example is how our chorus grew from rehearsal.",
    scenarioId: "artist-interview",
    reflection: "무대가 끝난 뒤에도 네 인사는 화면 밖으로 오래 남았어.",
    keepsake: "첫 방송 큐시트",
  }),
  episode({
    id: "first-fan-meeting",
    chapterId: "firstwin",
    title: "처음 들은 이름",
    location: "서울 · 작은 팬미팅 무대",
    sceneKey: "fan-meeting",
    guide: "mira",
    setup: "객석에서 우리 팀 이름을 부르는 목소리가 들린다. 미라가 먼저 손을 흔든다.",
    dialogue: "미라: 우리 노래를 들어준 이유를 물어봐도 될까? 그리고 네 이야기도 한 조각 들려줘.",
    objective: "팬에게 인사하고, 내 노래의 개인적인 의미를 설명한 뒤 고마움을 표현해요.",
    englishExample: "Nice to meet you at our first fan meeting. I wrote this song with our team. Thanks for supporting us.",
    scenarioId: "fan-meeting",
    reflection: "관객은 숫자가 아니라 서로의 하루를 들려주는 사람이 되었어.",
    keepsake: "첫 팬의 손편지",
  }),
  episode({
    id: "first-win-encore",
    chapterId: "firstwin",
    title: "울면서 부른 앙코르",
    location: "서울 · 첫 1위 앙코르 무대",
    sceneKey: "firstwin",
    guide: "luna",
    setup: "트로피보다 먼저 서로의 손을 잡았다. 루나는 숨을 고르고 스태프 쪽을 본다.",
    dialogue: "루나: 오늘 여기까지 온 사람들의 이름을 잊지 말자. 누구에게 먼저 고마움을 말할래?",
    objective: "이룬 일을 말하고, 도와준 사람을 한 명 구체적으로 언급하며 감사해요.",
    englishExample: "This award means a lot. We grew together. I want to thank our team for believing in us.",
    scenarioId: "acceptance-speech",
    reflection: "완벽하지 않은 앙코르라서 오히려 모두의 진심이 들렸어.",
    keepsake: "첫 1위 트로피 리본",
  }),
  episode({
    id: "korea-number-one",
    chapterId: "dome",
    title: "국내 정상의 객석",
    location: "서울 · 고척돔",
    sceneKey: "korea",
    guide: "nova",
    setup: "빈 연습실의 거울 대신 돔의 객석이 시야를 채운다. 노바가 가장 먼 좌석을 가리킨다.",
    dialogue: "노바: 여기까지 온 준비를 한 문장으로 말해보자. 무대 아래 사람들에게도 들리게.",
    objective: "준비 과정을 설명하고, 팀의 국내 성공이 왜 의미 있는지 동료를 안심시키며 말해요.",
    englishExample: "Our new song tells a story about carrying Seoul with us. One example is our midnight practice before the first broadcast.",
    scenarioId: "artist-interview",
    reflection: "국내에서 가장 큰 무대에 서도 처음의 연습 방식은 너희 안에 남아 있었어.",
    keepsake: "고척돔 입장 팔찌",
  }),
  episode({
    id: "domestic-award-thanks",
    chapterId: "daesang",
    title: "이름을 불러준 사람들",
    location: "서울 · 국내 시상식",
    sceneKey: "awards",
    guide: "luna",
    setup: "수상 순서가 다가올수록 루나의 손이 조용히 떨린다. 이번에는 네가 먼저 말을 건넨다.",
    dialogue: "루나: 나도 긴장돼. 우리가 받은 박수를 누구와 나누고 싶은지 함께 말해줄래?",
    objective: "성과를 구체적으로 말하고, 동료와 스태프에게 고마움을 전하며 다음 바람을 밝혀요.",
    englishExample: "This award means a lot. We grew together, and practice taught me patience.",
    scenarioId: "acceptance-speech",
    reflection: "정상의 순간에도 누군가의 이름을 부르는 일이 너희를 지켜줬어.",
    keepsake: "국내 대상 리허설 카드",
  }),
  episode({
    id: "tokyo-arrival",
    chapterId: "tokyo",
    title: "처음 건넨 길 묻기",
    location: "도쿄 · 공연장으로 가는 역",
    sceneKey: "tokyo",
    guide: "mira",
    setup: "외운 인사는 잘 나왔지만 환승 표지판 앞에서 모두 멈춘다. 미라가 지도를 펼친다.",
    dialogue: "미라: 모르는 건 부끄러운 일이 아니야. 다시 물어보고 우리가 원하는 곳을 설명해보자.",
    objective: "길을 묻고, 들은 안내를 확인하며 공연장에 필요한 요청을 분명하게 말해요.",
    englishExample: "Where is the concert hall? Could you repeat those directions? Thank you for your help.",
    scenarioId: "tour-arrival",
    reflection: "국경을 넘은 첫날, 도움을 청하는 문장이 우리를 앞으로 데려갔어.",
    keepsake: "도쿄 환승 지도",
  }),
  episode({
    id: "bangkok-fan-hello",
    chapterId: "bangkok",
    title: "다른 언어의 같은 환호",
    location: "방콕 · 아시아 투어 팬 이벤트",
    sceneKey: "bangkok",
    guide: "nova",
    setup: "서로 다른 억양의 인사가 한꺼번에 들린다. 노바가 팬에게 마이크를 내민다.",
    dialogue: "노바: 완벽한 문장보다 진짜 호기심이 먼저야. 팬의 이야기를 듣고 네 취향도 알려줘.",
    objective: "다른 나라의 팬에게 인사하고, 내 취향을 설명하며 질문에 답하고 고마워해요.",
    englishExample: "Nice to meet you tonight. My favorite song is Starlight. Thanks for supporting us.",
    scenarioId: "fan-meeting",
    reflection: "아시아의 여러 무대가 하나의 목소리를 요구한 게 아니라 서로의 이야기를 기다렸어.",
    keepsake: "방콕 팬 이벤트 손목밴드",
  }),
  episode({
    id: "asia-number-one",
    chapterId: "bangkok",
    title: "아시아가 부른 이름",
    location: "방콕 · 아시아 투어 피날레",
    sceneKey: "asia-finale",
    guide: "sol",
    setup: "투어의 마지막 밤, 솔은 각 도시의 메모가 붙은 무대 뒤 벽을 바라본다.",
    dialogue: "솔: 우리가 배운 건 숫자가 아니야. 여러 관객에게 같은 마음을 다르게 전한 방법이지.",
    objective: "아시아 투어의 성장을 설명하고, 한 관객의 경험을 예로 들며 팀의 배움을 말해요.",
    englishExample: "Our new song tells a story about audiences finding one another. One example is how our chorus grew from rehearsal.",
    scenarioId: "artist-interview",
    reflection: "아시아 넘버원이 된 밤에도 가장 오래 기억한 건 관객 한 사람의 질문이었어.",
    keepsake: "아시아 투어 마지막 세트리스트",
  }),
  episode({
    id: "la-first-interview",
    chapterId: "la",
    title: "영어로 맞이한 아침",
    location: "로스앤젤레스 · 첫 미국 인터뷰 스튜디오",
    sceneKey: "interview",
    guide: "luna",
    setup: "통역 부스가 있지만, 오늘은 네가 먼저 답해보기로 했다. 질문이 예상보다 빠르게 온다.",
    dialogue: "루나: 다 알아듣지 못해도 괜찮아. 핵심을 확인하고 네 경험을 하나만 들려줘.",
    objective: "질문을 다시 확인하고, 노래에 관한 답과 구체적인 경험을 덧붙여요.",
    englishExample: "Could you clarify that? Our new song tells a story about courage.",
    scenarioId: "artist-interview",
    reflection: "유창함보다 다시 물어보고 끝까지 답한 용기가 첫 미국 아침을 열었어.",
  }),
  episode({
    id: "ny-radio-live",
    chapterId: "ny",
    title: "대본 없는 라디오",
    location: "뉴욕 · 생방송 라디오 부스",
    sceneKey: "radio",
    guide: "sol",
    setup: "카운트다운 뒤에는 빈 종이만 남았다. 솔이 손가락으로 다음 질문을 가리킨다.",
    dialogue: "솔: 완벽한 답을 찾지 말고 우리 팀의 실제 이야기를 한 장면으로 말해.",
    objective: "예상하지 못한 질문에 답하고, 팀의 경험을 예로 들며 잘 들리지 않은 부분을 확인해요.",
    englishExample: "Our new song tells a story about an unfinished midnight take. Could you clarify that?",
    scenarioId: "artist-interview",
    reflection: "대본이 없어서 오히려 네 말의 온도가 그대로 전파를 탔어.",
  }),
  episode({
    id: "coachella",
    chapterId: "vegas",
    title: "사막에서 함께 부르기",
    location: "캘리포니아 · Coachella 페스티벌",
    sceneKey: "coachella",
    guide: "nova",
    setup: "사막의 바람이 인이어를 흔든다. 관객의 함성이 박자를 덮자 노바가 손을 내민다.",
    dialogue: "노바: 우리만 크게 부르는 무대가 아니야. 관객에게 후렴을 맡기고 함께 가자.",
    objective: "관객에게 인사하고 노래를 소개한 뒤, 함께 부르자고 초대해요.",
    englishExample: "Welcome to our show. The wind is loud, so let's sing this together.",
    scenarioId: "festival-audience",
    reflection: "Coachella의 모래바람 속에서 너희는 혼자 증명하는 대신 관객과 무대를 나눴어.",
    keepsake: "Coachella 패스",
  }),
  episode({
    id: "vegas-arena-recovery",
    chapterId: "vegas",
    title: "실수 다음의 한 박자",
    location: "라스베이거스 · 대형 아레나",
    sceneKey: "vegas",
    guide: "mira",
    setup: "전환 음악이 한 박자 늦었다. 미라가 관객을 향해 손을 들고 네가 이어갈 틈을 만든다.",
    dialogue: "미라: 실수를 숨기려 하지 말고 관객을 우리 편으로 초대하자. 다음 말을 먼저 건네줘.",
    objective: "관객에게 인사하고 노래를 소개한 뒤, 함께 다시 시작하자고 초대해요.",
    englishExample: "We are glad you are here. Let's sing this together after the timing problem.",
    scenarioId: "festival-audience",
    reflection: "북미 무대의 돌파구는 실수 없는 공연이 아니라 함께 다시 시작한 순간이었어.",
  }),
  episode({
    id: "north-america-number-one",
    chapterId: "vegas",
    title: "북미의 첫 정상",
    location: "라스베이거스 · 투어 브레이크의 기자회견",
    sceneKey: "vegas",
    guide: "luna",
    setup: "기자들의 질문이 이어진다. 루나는 네가 처음 미국에 도착했던 날의 메모를 건넨다.",
    dialogue: "루나: 처음의 우리와 오늘의 우리를 연결해서 말해줘. 숫자보다 변화를 들려주자.",
    objective: "북미에서 이룬 변화를 설명하고, 구체적인 공연 경험과 팀의 다음 목표를 말해요.",
    englishExample: "Our new song tells a story about meeting new audiences. One example is our midnight practice before the first broadcast.",
    scenarioId: "artist-interview",
    reflection: "북미 넘버원은 도착점이라기보다 처음의 두려움을 팀의 언어로 바꾼 증거였어.",
    keepsake: "북미 투어 패스포트 스탬프",
  }),
  episode({
    id: "london-joke-listen",
    chapterId: "london",
    title: "웃음의 속도를 듣기",
    location: "런던 · 현지 방송 대기실",
    sceneKey: "london",
    guide: "mira",
    setup: "진행자의 농담이 지나가고 잠깐의 정적이 흐른다. 미라가 웃으며 천천히 뜻을 묻는다.",
    dialogue: "미라: 못 알아들었다고 숨지 말자. 웃음의 뜻을 물어보고 우리 경험으로 이어가면 돼.",
    objective: "농담의 뜻을 정중하게 확인하고, 내 경험을 예로 들어 대화를 이어가요.",
    englishExample: "Could you clarify that? Our practice shaped the song.",
    scenarioId: "artist-interview",
    reflection: "다른 웃음에 귀 기울인 일이 유럽에서 서로를 이해하는 첫 장면이 됐어.",
  }),
  episode({
    id: "paris-creative-repair",
    chapterId: "paris",
    title: "무대 뒤에서 다르게 말하기",
    location: "파리 · 공연장 백스테이지",
    sceneKey: "paris",
    guide: "sol",
    setup: "솔은 마지막 동선이 마음에 들지 않는다. 모두 지쳤지만 네 의견을 기다린다.",
    dialogue: "솔: 내 취향을 말하되 네가 본 문제도 먼저 인정할게. 오늘 가능한 다음 수를 찾자.",
    objective: "내 선호를 이유와 함께 말하고, 다른 의견을 인정한 뒤 함께 실행할 방법을 제안해요.",
    englishExample: "I prefer a quiet ending for the encore because it gives the song more space. I understand your idea about the big finish; let's combine both ideas in rehearsal tonight.",
    scenarioId: "creative-repair",
    reflection: "다르게 말하는 법을 배운 뒤에야 네 사람의 목소리가 한 편곡처럼 들렸어.",
  }),
  episode({
    id: "barcelona-breathe",
    chapterId: "barcelona",
    title: "일정 사이의 숨",
    location: "바르셀로나 · 공연 전 골목",
    sceneKey: "barcelona",
    guide: "nova",
    setup: "관광할 시간은 짧고 일정은 길다. 노바가 오늘 꼭 보고 싶은 한 가지를 묻는다.",
    dialogue: "노바: 전부 해내려 하지 말고 지금 우리에게 필요한 휴식을 고르자.",
    objective: "현재의 피로를 설명하고, 조정을 요청하며, 팀이 함께할 작은 계획을 제안해요.",
    englishExample: "Let's rehearse the chorus again before the next take because we need tighter timing.",
    scenarioId: "team-rehearsal",
    reflection: "도시를 살아볼 여유를 만든 날, 투어는 생존 일정에서 우리의 시간이 되었어.",
  }),
  episode({
    id: "rome-old-stage",
    chapterId: "rome",
    title: "오래된 무대 옆에서",
    location: "로마 · 콜로세움 근처 야외 무대",
    sceneKey: "rome",
    guide: "luna",
    setup: "수천 년 된 돌벽 곁에서 오늘의 무대를 준비한다. 루나는 시간에 남는 노래를 생각한다.",
    dialogue: "루나: 오래 남는다는 건 완벽하다는 뜻이 아닐 거야. 우리가 배운 한 가지를 말해줘.",
    objective: "함께 이룬 성장을 돌아보고, 팀에 고마움을 전하며, 계속 배울 다음 마음을 말해요.",
    englishExample: "We have grown so much. I appreciate our team, and I hope to keep learning.",
    scenarioId: "career-reflection",
    reflection: "오래된 돌 앞에서 너희는 지금의 목소리도 누군가의 기억이 될 수 있음을 느꼈어.",
    keepsake: "로마 공연 손도장 포스터",
  }),
  episode({
    id: "dubai-desert-echo",
    chapterId: "dubai",
    title: "사막에 맞춘 요청",
    location: "두바이 · 사막 야외 공연장",
    sceneKey: "dubai",
    guide: "sol",
    setup: "열기와 바람 때문에 무대 장비의 위치를 바꿔야 한다. 솔이 네 의견을 먼저 듣는다.",
    dialogue: "솔: 문제가 뭔지 정확히 말하고, 관객에게 약속할 수 있는 다음 행동을 정하자.",
    objective: "공연의 문제를 설명하고 필요한 조정을 요청한 뒤, 관객에게 다음 순서를 안내해요.",
    englishExample: "Let's rehearse the chorus again before the next take. I agree with your idea and I can help with the count.",
    scenarioId: "team-rehearsal",
    reflection: "사막의 함성은 큰 목소리보다 서로를 조정하는 침착함에 응답했어.",
  }),
  episode({
    id: "sydney-world-stage",
    chapterId: "sydney",
    title: "다른 장르의 무대",
    location: "시드니 · 오페라하우스 앞 공연장",
    sceneKey: "sydney",
    guide: "mira",
    setup: "익숙한 응원법이 없는 무대다. 미라는 관객에게 노래의 배경부터 소개하자고 한다.",
    dialogue: "미라: 우리 경험을 먼저 들려주면 관객도 자기 방식으로 함께할 수 있어.",
    objective: "관객에게 인사하고 노래를 소개하며 마지막 구절을 함께 부르자고 초대해요.",
    englishExample: "Welcome to our show. This song is about finding courage; sing along with us.",
    scenarioId: "festival-audience",
    reflection: "익숙한 응원법이 없어도 이야기가 있으면 관객은 자기 방식으로 답해줬어.",
  }),
  episode({
    id: "rio-audience-story",
    chapterId: "rio",
    title: "남반구에서 들은 후렴",
    location: "리우 · 해변 야외 무대",
    sceneKey: "rio",
    guide: "nova",
    setup: "관객의 후렴이 예상보다 길게 이어진다. 노바가 웃으며 네게 마이크를 돌린다.",
    dialogue: "노바: 그들의 목소리를 먼저 칭찬하고, 우리 팀의 이야기를 한 장면으로 답해보자.",
    objective: "관객에게 인사하고 노래를 소개한 뒤, 함께 부르자고 초대해요.",
    englishExample: "We are glad you are here. Our next song tells a story; let's sing this together.",
    scenarioId: "festival-audience",
    reflection: "멀리 온 만큼 새로운 후렴이 생겼고, 그 후렴은 너희 노래의 일부가 되었어.",
  }),
  episode({
    id: "asia-award-return",
    chapterId: "mama",
    title: "다시 고향의 언어로",
    location: "서울 · 아시아 시상식",
    sceneKey: "world-awards",
    guide: "luna",
    setup: "여러 나라의 자막이 켜진다. 루나는 가장 먼저 함께 시작한 연습실을 떠올린다.",
    dialogue: "루나: 세계의 무대에 서도 우리가 받은 도움을 잊지 말자. 누구에게 먼저 인사할래?",
    objective: "아시아에서의 성장을 설명하고, 구체적인 사람에게 감사하며 앞으로의 희망을 말해요.",
    englishExample: "This award means a lot. I want to thank our team for believing in us.",
    scenarioId: "acceptance-speech",
    reflection: "자막이 많아질수록 고마운 사람의 이름은 더 구체적으로 말하고 싶어졌어.",
    keepsake: "아시아 시상식 이름표",
  }),
  episode({
    id: "billboard-story",
    chapterId: "billboard",
    title: "차트보다 먼저 있던 밤",
    location: "뉴욕 · 차트 발표를 기다리는 호텔방",
    sceneKey: "billboard",
    guide: "sol",
    setup: "알림이 오기 전까지 방 안이 조용하다. 솔이 모두에게 처음의 연습실 이야기를 부탁한다.",
    dialogue: "솔: 결과를 기다리는 동안에도 우리가 왜 시작했는지는 말할 수 있어.",
    objective: "팀의 성장을 한 장면으로 설명하고, 결과와 상관없이 지키고 싶은 가치를 말해요.",
    englishExample: "Our new song tells a story about one promise kept. One example is how our chorus grew from rehearsal.",
    scenarioId: "artist-interview",
    reflection: "차트의 숫자가 뜬 뒤에도 너희가 먼저 떠올린 건 숫자보다 방의 냄새였어.",
    keepsake: "차트 발표 알림 카드",
  }),
  episode({
    id: "grammy-nomination-call",
    chapterId: "grammy-nom",
    title: "후보라는 전화",
    location: "서울 · 새벽의 연습실",
    sceneKey: "nomination",
    guide: "mira",
    setup: "전화가 끝난 뒤 아무도 바로 말하지 못한다. 미라가 처음의 오디션 번호표를 꺼낸다.",
    dialogue: "미라: 놀라운 소식일수록 천천히 말해도 돼. 우리가 변한 점을 하나씩 떠올려보자.",
    objective: "함께 이룬 성장을 돌아보고, 팀에 고마움을 전하며, 계속 배울 다음 마음을 말해요.",
    englishExample: "We have grown so much. I appreciate our team, and I hope to keep learning.",
    scenarioId: "career-reflection",
    reflection: "후보 지명은 끝의 증명이 아니라 첫 방에서 이어진 문장이 아직 쓰이고 있다는 신호였어.",
    keepsake: "그래미 후보 지명 편지",
  }),
  episode({
    id: "grammy-red-carpet",
    chapterId: "grammy-win",
    title: "레드카펫에서 다시 묻기",
    location: "로스앤젤레스 · 그래미 레드카펫",
    sceneKey: "red-carpet",
    guide: "nova",
    setup: "플래시가 쏟아지고 기자가 빠르게 질문한다. 노바가 네가 가장 기억하는 장면을 묻는다.",
    dialogue: "노바: 오늘의 옷보다 오래 남을 답을 해보자. 처음과 지금을 연결해줘.",
    objective: "변화를 회고하고, 질문을 확인하며, 첫 연습실의 한 장면과 지금의 마음을 연결해요.",
    englishExample: "Could you clarify that? Our practice shaped the song.",
    scenarioId: "artist-interview",
    reflection: "세계의 카메라 앞에서도 가장 선명한 배경은 첫 연습실의 거울이었어.",
  }),
  episode({
    id: "grammy-performance-night",
    chapterId: "grammy-win",
    title: "가장 큰 무대에서 함께 부르기",
    location: "로스앤젤레스 · 그래미 퍼포먼스 스테이지",
    sceneKey: "grammy-performance",
    guide: "nova",
    setup: "조명이 객석을 가리고 네 사람의 실루엣만 남긴다. 노바가 마지막 후렴을 가리킨다.",
    dialogue: "노바: 이 노래가 여기까지 온 길을 관객에게 건네자. 마지막 한 줄은 모두와 함께 부를 거야.",
    objective: "관객에게 인사하고 노래를 소개한 뒤, 함께 부르자고 초대해요.",
    englishExample: "We are glad you are here. Our next song tells a story; let's sing this together.",
    scenarioId: "festival-audience",
    reflection: "가장 큰 조명 아래에서도 너희를 움직인 건 첫 방에서 함께 맞춘 한 박자였어.",
    keepsake: "그래미 퍼포먼스 세트리스트",
  }),
  episode({
    id: "grammy-acceptance",
    chapterId: "grammy-win",
    title: "우리 말로 받은 무대",
    location: "로스앤젤레스 · 그래미 어워드 스테이지",
    sceneKey: "grammy",
    guide: "luna",
    setup: "이름이 불리고 네 사람이 천천히 무대로 오른다. 루나는 마이크를 네 쪽으로 기울인다.",
    dialogue: "루나: 준비한 문장보다 진짜 고마운 사람을 먼저 떠올려. 네가 배운 것을 말해줘.",
    objective: "이룬 성취를 이름 붙이고, 구체적인 사람에게 감사하며, 배움과 다음 희망을 말해요.",
    englishExample: "This award means a lot. I want to thank our team for believing in us.",
    scenarioId: "acceptance-speech",
    reflection: "영어로 전한 소감 끝에 서로를 바라본 순간, 이 무대는 네 사람의 집처럼 느껴졌어.",
    keepsake: "그래미 무대 프로그램",
  }),
  episode({
    id: "homecoming",
    chapterId: "grammy-win",
    title: "처음 방으로 돌아오기",
    location: "서울 · 불을 켜지 않은 첫 연습실",
    sceneKey: "epilogue",
    guide: "mira",
    setup: "오래된 거울 옆에 오디션 번호표와 무대 패스가 놓여 있다. 미라가 빈 노트를 펼친다.",
    dialogue: "미라: 여기서 시작한 우리가 여기로 돌아왔어. 다음에 배우고 싶은 한 문장을 적어볼래?",
    objective: "함께 이룬 성장을 돌아보고, 팀에 고마움을 전하며, 계속 배울 다음 마음을 말해요.",
    englishExample: "We have grown so much. I learned from mistakes, and I hope to keep learning.",
    scenarioId: "career-reflection",
    reflection: "처음과 같은 방이지만, 이제 거울에는 처음 함께 모인 네 사람이 다시 돌아와 서 있어.",
    keepsake: "첫 노트의 마지막 페이지",
  }),
] as const;

const EPISODES_BY_ID = new Map(
  WIND_DOWN_STORY_EPISODES.map((storyEpisode) => [storyEpisode.id, storyEpisode]),
);

const EPISODES_BY_CHAPTER = new Map<string, readonly WindDownStoryEpisode[]>();
for (const storyEpisode of WIND_DOWN_STORY_EPISODES) {
  const episodes = EPISODES_BY_CHAPTER.get(storyEpisode.chapterId) ?? [];
  EPISODES_BY_CHAPTER.set(storyEpisode.chapterId, [...episodes, storyEpisode]);
}

export function storyEpisodesForChapter(
  chapterId: string,
): readonly WindDownStoryEpisode[] {
  return EPISODES_BY_CHAPTER.get(chapterId) ?? [];
}

export function storyEpisodeById(
  id: string,
): WindDownStoryEpisode | null {
  return EPISODES_BY_ID.get(id) ?? null;
}

function safeStoryXp(rawXp: number): number {
  // Invalid progress reads may show the already-safe opening room only. They
  // must never be interpreted as a large XP value by this presentation layer.
  return Number.isFinite(rawXp) && rawXp >= 0 ? rawXp : 0;
}

/**
 * Resolve scene state from authoritative XP. All episodes at the current chapter are
 * current; earlier unlocked chapters are replay; locked chapters are preview.
 * Episode viewing is not separately persisted or sequenced. Viewing and replaying never mutate this state or grant progress.
 */
export function storyEpisodeState(
  storyEpisode: WindDownStoryEpisode,
  rawXp: number,
): WindDownStoryEpisodeState {
  const xp = safeStoryXp(rawXp);
  const chapter = WIND_DOWN_CHAPTERS.find(
    (candidate) => candidate.id === storyEpisode.chapterId,
  );
  if (!chapter || !isChapterUnlocked(chapter, xp)) return "preview";
  const current: WindDownChapter = currentChapter(xp);
  return current.id === chapter.id ? "current" : "replay";
}

/**
 * Construct the allowlisted roleplay handoff. Only story and scenario
 * identifiers cross the navigation boundary; authored copy stays in catalogs.
 */
export function storyRoleplayHref(
  storyEpisode: WindDownStoryEpisode,
): string {
  const params = new URLSearchParams({
    scenario: storyEpisode.scenarioId,
    story: storyEpisode.id,
  });
  return `/winddown/roleplay?${params.toString()}`;
}
