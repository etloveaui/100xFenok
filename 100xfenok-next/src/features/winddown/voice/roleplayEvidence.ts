/** Conservative deterministic task evidence; it is not a general semantic score. */
export function windDownRoleplayEvidenceText(text: string): string {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'");
  // A vocabulary/translation question is not evidence of performing its quoted task.
  if (/\b(?:what (?:does|do|is|are).{0,100}mean|how (?:do|can) (?:i|you) say|meaning of|translate|say the words?|phrase|sentence)\b|(?:무슨|어떤)\s*뜻|번역|표현.{0,15}(뜻|의미)/i.test(normalized)) return "";
  return normalized.replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g, " ")
    .replace(/(^|\s)'[^'\n]+'(?=\s|[.!?,]|$)/g, " ").replace(/\s+/g, " ").trim();
}
export function supportedWindDownRoleplayTask(scenario: string, goal: string, text: string): string | null | undefined {
  if (scenario !== "cafe-order" && scenario !== "after-work-check-in") return undefined;
  const clauses = text.split(/[.!?;]+/).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (/\b(?:do not|don't|would not|wouldn't|cannot|can't|not going to|never)\b/.test(clause)) continue;
    if (scenario === "cafe-order") {
      const drink = /\b(?:coffee|latte|tea|espresso|cappuccino|americano|mocha|chai|juice|water|cocoa|chocolate|smoothie)\b/.exec(clause);
      if (goal === "order" && drink && (/\b(?:i'd like|i would like|can i (?:get|have)|could i (?:get|have)|i'll have|i will have|may i have)\b/.test(clause) || /\bplease\b/.test(clause))) return clause;
      if (goal === "preference" && /\b(?:with (?:oat|soy|almond) milk|without ice|no ice|less sweet|decaf|not too sweet)\b/.test(clause)) return clause;
      if (goal === "close" && /^(?:(?:okay|ok|and|yes),?\s*)?(?:that's all|that will be all|thank you|thanks)\b/.test(clause)) return clause;
    } else {
      if (goal === "feeling" && /\b(?:i (?:feel|felt|am|was)|i'm(?: feeling)?|my day was|today was)\s+(?:(?:a little|really|very|so|quite)\s+)?(?:good|bad|happy|sad|tired|exhausted|excited|nervous|calm|relaxed|anxious|great|okay|ok|busy|stressful|stressed|proud|better|fine)\b/.test(clause)) return clause;
      if (goal === "reason" && /\b(?:because|since)\s+[a-z]+(?:\s+[a-z']+){1,}/.test(clause)) return clause;
      if (goal === "next-step" && /\b(?:tomorrow (?:i'll|i will)|i'm going to|i am going to|i want to)\s+(?!know what\b)[a-z]+(?:\s+[a-z']+)?/.test(clause)) return clause;
    }
  }
  return null;
}
