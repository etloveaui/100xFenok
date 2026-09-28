/**
 * WIND DOWN world-tour content.
 *
 * Everything here is DATA. Adding an act, a chapter, or a region must never
 * require a change in a renderer or a reducer: consumers resolve scenes through
 * a registry and fall back safely on an unknown key.
 */

export type ActId = string;

export type WindDownAct = {
  readonly id: ActId;
  readonly tag: string;
  readonly name: string;
};

export type WindDownChapter = {
  readonly id: string;
  readonly act: ActId;
  readonly label: string;
  readonly country: string;
  /** one-line beat shown when the chapter opens */
  readonly beat: string;
  /** scene key resolved through the painter registry */
  readonly scene: string;
  /** companion level at which this chapter unlocks */
  readonly unlockLevel: number;
};

export type WindDownRegion = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** normalised position on the stylised world plate, 0..1 */
  readonly x: number;
  readonly y: number;
  /** expression topic this region stands for */
  readonly topic: string;
};

export const WIND_DOWN_ACTS: readonly WindDownAct[] = [
  { id: "audition", tag: "ACT I", name: "오디션" },
  { id: "trainee", tag: "ACT II", name: "연습생" },
  { id: "debut", tag: "ACT III", name: "데뷔" },
  { id: "domestic", tag: "ACT IV", name: "국내 정상" },
  { id: "asia", tag: "ACT V", name: "아시아" },
  { id: "americas", tag: "ACT VI", name: "미주" },
  { id: "europe", tag: "ACT VII", name: "유럽" },
  { id: "world", tag: "ACT VIII", name: "월드" },
  { id: "grammy", tag: "ACT IX", name: "그래미" },
];

export const WIND_DOWN_CHAPTERS: readonly WindDownChapter[] = [
  { id: "practice", act: "audition", label: "연습실", country: "SEOUL", scene: "studio", unlockLevel: 1, beat: "아무도 몰랐던 밤. 여기서 시작했어." },
  { id: "audition", act: "audition", label: "오디션장", country: "SEOUL", scene: "audition", unlockLevel: 3, beat: "번호표를 받았어. 이름 대신 숫자로 불렸지." },
  { id: "dorm", act: "trainee", label: "합숙소", country: "SEOUL", scene: "dorm", unlockLevel: 5, beat: "붙었어. 이제부터가 진짜야." },
  { id: "reveal", act: "trainee", label: "데뷔조 발표", country: "SEOUL", scene: "reveal", unlockLevel: 7, beat: "네 명의 데뷔조가 처음 한자리에 섰어." },
  { id: "musicshow", act: "debut", label: "음악방송", country: "SEOUL", scene: "musicshow", unlockLevel: 10, beat: "첫 무대. 다리가 떨렸지만 끝까지 했어." },
  { id: "firstwin", act: "debut", label: "첫 1위", country: "SEOUL", scene: "firstwin", unlockLevel: 13, beat: "1위. 울면서 인사했어." },
  { id: "dome", act: "domestic", label: "고척돔", country: "SEOUL", scene: "dome", unlockLevel: 16, beat: "돔을 채웠어. 국내에서 더 갈 곳이 없어." },
  { id: "daesang", act: "domestic", label: "시상식", country: "SEOUL", scene: "daesang", unlockLevel: 19, beat: "대상. 다음은 밖이야." },
  { id: "tokyo", act: "asia", label: "도쿄", country: "JAPAN", scene: "tokyo", unlockLevel: 22, beat: "일본어 인사는 외웠는데, 영어가 남았어." },
  { id: "bangkok", act: "asia", label: "방콕", country: "THAILAND", scene: "bangkok", unlockLevel: 24, beat: "아시아는 통했어." },
  { id: "la", act: "americas", label: "LA", country: "USA", scene: "palm", unlockLevel: 26, beat: "영어로만 진행되는 첫 인터뷰." },
  { id: "ny", act: "americas", label: "뉴욕", country: "USA", scene: "skyline", unlockLevel: 28, beat: "라디오 생방송. 대본이 없었어." },
  { id: "vegas", act: "americas", label: "라스베가스", country: "USA", scene: "sphere", unlockLevel: 31, beat: "구체 안에서, 내 얼굴이 도시만 했어." },
  { id: "london", act: "europe", label: "런던", country: "UK", scene: "bigben", unlockLevel: 33, beat: "유럽 첫 도시. 농담을 알아들었어." },
  { id: "paris", act: "europe", label: "파리", country: "FRANCE", scene: "eiffel", unlockLevel: 35, beat: "무대 뒤에서 영어로 싸우고 화해했어." },
  { id: "barcelona", act: "europe", label: "바르셀로나", country: "SPAIN", scene: "sagrada", unlockLevel: 37, beat: "끝나지 않는 건 성당만이 아니야." },
  { id: "rome", act: "europe", label: "로마", country: "ITALY", scene: "colosseo", unlockLevel: 39, beat: "2천 년 된 무대 옆에서 노래했어." },
  { id: "dubai", act: "world", label: "두바이", country: "UAE", scene: "burj", unlockLevel: 42, beat: "사막에서도 떼창이 나왔어." },
  { id: "sydney", act: "world", label: "시드니", country: "AUSTRALIA", scene: "opera", unlockLevel: 44, beat: "오페라하우스. 클래식 무대에 우리가 섰어." },
  { id: "rio", act: "world", label: "리우", country: "BRAZIL", scene: "christ", unlockLevel: 46, beat: "남반구까지 왔어." },
  { id: "mama", act: "world", label: "MAMA", country: "ASIA", scene: "mama", unlockLevel: 49, beat: "아시아 대상. 우리 이름을 아시아가 불렀어." },
  { id: "billboard", act: "world", label: "빌보드 1위", country: "CHART", scene: "billboard", unlockLevel: 52, beat: "핫100 1위. 시작은 그 연습실이었어." },
  { id: "grammy-nom", act: "grammy", label: "그래미 노미네이트", country: "GRAMMY", scene: "awards", unlockLevel: 56, beat: "후보에 이름이 올랐어." },
  { id: "grammy-win", act: "grammy", label: "그래미 본상", country: "GRAMMY", scene: "grammy", unlockLevel: 61, beat: "받았어. 영어로 소감을 말했고, 안 떨었어." },
];

export const WIND_DOWN_REGIONS: readonly WindDownRegion[] = [
  { id: "seoul", label: "서울", group: "HOME", x: 0.845, y: 0.36, topic: "하루 끝" },
  { id: "tokyo", label: "도쿄", group: "ASIA", x: 0.893, y: 0.385, topic: "잠들기 전" },
  { id: "bangkok", label: "방콕", group: "ASIA", x: 0.795, y: 0.52, topic: "몸과 마음" },
  { id: "sydney", label: "시드니", group: "OCEANIA", x: 0.905, y: 0.79, topic: "주말" },
  { id: "la", label: "LA", group: "AMERICAS", x: 0.135, y: 0.375, topic: "일상 회화" },
  { id: "vegas", label: "라스베가스", group: "AMERICAS", x: 0.17, y: 0.395, topic: "과장·감탄" },
  { id: "ny", label: "뉴욕", group: "AMERICAS", x: 0.265, y: 0.345, topic: "일" },
  { id: "rio", label: "리우", group: "AMERICAS", x: 0.325, y: 0.725, topic: "감정" },
  { id: "london", label: "런던", group: "EUROPE", x: 0.487, y: 0.265, topic: "격식" },
  { id: "paris", label: "파리", group: "EUROPE", x: 0.505, y: 0.3, topic: "취향" },
  { id: "rome", label: "로마", group: "EUROPE", x: 0.525, y: 0.34, topic: "음식" },
  { id: "dubai", label: "두바이", group: "MIDEAST", x: 0.63, y: 0.45, topic: "이동" },
];
