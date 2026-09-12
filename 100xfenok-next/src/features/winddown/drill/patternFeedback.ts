import type { WindDownPracticeMaterial } from "./practice";
export type WindDownPatternFeedback = {
  verdict: "supported" | "revise" | "uncertain";
  message: string;
  example: string;
};
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
export function assessWindDownPatternAttempt(material: WindDownPracticeMaterial, text: string): WindDownPatternFeedback {
  const answer = normalize(text);
  const example = material.practice?.variationsEn[0] ?? material.en;
  const references = [material.en, ...material.acceptedVariants, ...(material.practice?.variationsEn ?? [])];
  if (answer && references.some(reference => normalize(reference) === answer)) {
    return { verdict: "supported", message: "작성된 예시와 같은 표현이야. 뜻을 떠올리며 다른 상황에서도 써 봐.", example };
  }
  if (!answer || !/[a-z]/i.test(text) || /\b(?:asdf|qwer|zxcv|qwerty|asdfgh|blah)\b|([a-z])\1{4}/i.test(text)) {
    return { verdict: "revise", message: "뜻이 있는 영어 문장으로 다시 말해 봐. 아래 예시에서 사람이나 상황을 바꿔도 좋아.", example };
  }
  const pattern = material.practice?.pattern?.trim() ?? "";
  // Authored placeholders identify a known frame; matching it alone does not prove grammar.
  const marker = pattern.search(/\[|\+|\.{3}|…/);
  const prefix = marker >= 0 ? normalize(pattern.slice(0, marker)) : "";
  if (prefix && (answer === prefix || !answer.startsWith(prefix + " "))) {
    return { verdict: "revise", message: `이번 문형은 “${pattern}”이야. “${pattern.slice(0, marker).trim()}” 뒤에 필요한 말을 넣어서 다시 써 봐.`, example };
  }
  return { verdict: "uncertain", message: prefix
    ? "문형의 시작은 맞아. 다만 새로 만든 문장의 문법과 자연스러움까지는 확인하지 못했어. 예시와 비교해서 다시 다듬어 봐."
    : "예시와 다른 표현이야. 틀렸다고 단정할 수는 없어. 예시의 뜻과 어순을 비교해서 다시 말해 봐.", example };
}
