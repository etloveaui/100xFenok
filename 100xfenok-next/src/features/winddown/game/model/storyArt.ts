/** Original production illustrations. Each atlas has three equal landscape panels.
 * Only the active atlas is requested; no eager gallery or runtime image generation.
 */
export type WindDownStoryArt = {
  readonly src: string;
  readonly alt: string;
  readonly row: 0 | 1 | 2;
  readonly position?: string;
};

const art = (atlas: string, row: 0 | 1 | 2, alt: string): WindDownStoryArt => ({
  src: `/images/winddown/story/${atlas}-v1.png`, row, alt,
});

const STORY_ART: Readonly<Record<string, WindDownStoryArt>> = {
  'fan-meeting': art('career-moments', 0, '첫 팬 미팅에서 사인 앨범을 건네며 팬과 눈을 맞추는 팀'),
  'asia-finale': art('career-moments', 1, '아시아 투어 마지막 공연에서 커다란 관객석을 향해 인사하는 팀'),
  'red-carpet': art('career-moments', 2, '수상 결과를 기다리며 레드카펫에서 인터뷰하는 네 아티스트'),
  practice: art('beginnings', 0, '밤의 연습실에서 노트를 펼치고 서로 격려하는 네 동료'),
  audition: art('beginnings', 1, '오디션 심사대 앞에 함께 선 네 동료'),
  dorm: art('beginnings', 2, '합숙소의 작은 식탁에서 연습 계획을 나누는 팀'),
  reveal: art('debut', 0, '데뷔조 발표를 듣고 서로를 바라보는 네 사람'),
  broadcast: art('debut', 1, '카메라와 보랏빛 조명 사이에서 첫 방송을 준비하는 팀'),
  firstwin: art('debut', 2, '첫 음악방송 트로피를 함께 들고 기뻐하는 팀'),
  korea: art('korea-asia', 0, '관객의 불빛으로 가득 찬 서울 돔 무대'),
  awards: art('korea-asia', 1, '국내 시상식의 따뜻한 조명 아래 트로피를 나누는 동료들'),
  tokyo: art('korea-asia', 2, '도쿄 타워가 보이는 역에 여행 가방과 함께 도착한 팀'),
  bangkok: art('arrival-media', 0, '방콕 강변의 사원과 야경을 뒤로하고 팬에게 인사하는 팀'),
  interview: art('arrival-media', 1, 'LA의 야자수가 보이는 스튜디오에서 인터뷰하는 팀'),
  radio: art('arrival-media', 2, '뉴욕 라디오 부스에서 대본 없이 이야기를 나누는 동료들'),
  coachella: art('festival-europe', 0, '사막의 노을과 대관람차, 거대한 관객 앞에 선 코첼라 무대'),
  vegas: art('festival-europe', 1, '거대한 곡면 스크린 아래 북미 투어의 마지막 인사를 하는 팀'),
  london: art('festival-europe', 2, '비 내린 런던의 강변에서 웃으며 걷는 동료들'),
  paris: art('europe', 0, '에펠탑이 보이는 파리 대기실에서 안무 노트를 함께 보는 팀'),
  barcelona: art('europe', 1, '성당의 첨탑이 보이는 바르셀로나에서 사운드 체크하는 팀'),
  rome: art('europe', 2, '조명이 켜진 콜로세움 앞에서 젤라토와 대화를 즐기는 동료들'),
  dubai: art('world', 0, '별빛과 두바이의 높은 건물들 아래 펼쳐진 야외 공연'),
  sydney: art('world', 1, '시드니 오페라하우스 앞에서 공연 노트를 맞춰 보는 팀'),
  rio: art('world', 2, '리우의 푸른 산과 축제 불빛 아래 지친 동료를 격려하는 팀'),
  'world-awards': art('recognition', 0, '붉고 금빛으로 빛나는 아시아 시상식에서 함께 든 트로피'),
  billboard: art('recognition', 1, '대기실에서 차트 정상 소식을 함께 확인하는 네 사람'),
  nomination: art('recognition', 2, '호텔 방에서 그래미 후보 지명 전화를 받고 놀란 팀'),
  'grammy-performance': art('finale', 0, '웅장한 시상식 무대에서 함께 노래하는 네 아티스트'),
  grammy: art('finale', 1, '황금빛 트로피를 들고 동료들과 함께 전하는 수상 소감'),
  epilogue: art('finale', 2, '처음의 연습실로 돌아와 노트와 여행의 기억을 나누는 팀'),
};

export function storyArtFor(sceneKey: string): WindDownStoryArt {
  return STORY_ART[sceneKey] ?? STORY_ART.practice;
}
