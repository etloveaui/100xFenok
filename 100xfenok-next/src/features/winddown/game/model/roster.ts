/**
 * Original four-member roster. Renderers consume these parameters and copy,
 * rather than branching on a real-person name or likeness.
 */

export type MemberRole = "leader" | "center" | "rapper" | "maknae";

export type WindDownMember = {
  readonly id: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly roleLabel: string;
  readonly blurb: string;
  readonly tempo: number;
  readonly hair: {
    readonly length: number;
    readonly wave: number;
    readonly strands: number;
  };
  readonly outfit: "gown" | "stage" | "street";
  readonly voice: {
    readonly greet: string;
    readonly hint: string;
    readonly miss: string;
    readonly good: string;
    readonly done: string;
  };
};

export const WIND_DOWN_MEMBERS: readonly WindDownMember[] = [
  {
    id: "luna",
    name: "루나",
    role: "leader",
    roleLabel: "리더 · 메인보컬",
    blurb: "차분하게 중심을 잡는 쪽",
    tempo: 1,
    hair: { length: 3.4, wave: 0.9, strands: 6 },
    outfit: "gown",
    voice: {
      greet: "불 끄기 전에 딱 다섯 문장만 같이 하자.",
      hint: "천천히 해도 돼. 첫 단어만 볼래?",
      miss: "괜찮아, 잠시 뒤에 다시 만나자.",
      good: "좋아, 한 문장 쌓였어.",
      done: "오늘 밤도 잘 마무리했어.",
    },
  },
  {
    id: "nova",
    name: "노바",
    role: "center",
    roleLabel: "메인댄서 · 센터",
    blurb: "기운 끌어올려 주는 쪽",
    tempo: 1.9,
    hair: { length: 2.4, wave: 1.5, strands: 7 },
    outfit: "stage",
    voice: {
      greet: "조명 켰어. 오늘 다섯 문장, 가볍게 가자.",
      hint: "딱 한 단어만 줄게. 감 잡히면 바로 가자.",
      miss: "지금 건 워밍업. 다시 가자.",
      good: "그렇지, 이 감각이야.",
      done: "오늘 무대 완벽했어.",
    },
  },
  {
    id: "sol",
    name: "솔",
    role: "rapper",
    roleLabel: "래퍼 · 리드",
    blurb: "짧고 정확하게 밀어주는 쪽",
    tempo: 1.4,
    hair: { length: 1.6, wave: 0.4, strands: 5 },
    outfit: "street",
    voice: {
      greet: "짧게 가자. 다섯 문장이면 끝이야.",
      hint: "한 단어. 그거면 풀려.",
      miss: "틀린 게 아니라 아직인 거야.",
      good: "깔끔했어. 다음.",
      done: "오늘 벌스 다 소화했어.",
    },
  },
  {
    id: "mira",
    name: "미라",
    role: "maknae",
    roleLabel: "막내 · 서브보컬",
    blurb: "같이 천천히 걸어주는 쪽",
    tempo: 0.7,
    hair: { length: 4.2, wave: 1.2, strands: 8 },
    outfit: "gown",
    voice: {
      greet: "졸리면 세 개만 해도 돼. 옆에 있을게.",
      hint: "같이 볼까? 첫 단어만 알려줄게.",
      miss: "나도 이거 자주 틀려. 괜찮아.",
      good: "우와, 됐다.",
      done: "오늘도 끝까지 했네. 대단해.",
    },
  },
];

export function memberById(id: string): WindDownMember {
  return WIND_DOWN_MEMBERS.find((member) => member.id === id)
    ?? WIND_DOWN_MEMBERS[0];
}
