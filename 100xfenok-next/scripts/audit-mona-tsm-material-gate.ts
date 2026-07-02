import { listMonaVnextGeneratedExpressionEntries } from "../src/features/mona-vnext/server/expressionBank";
import { monaExpressionToTeacherMaterialCandidate } from "../src/features/mona-vnext/teacher/teacherAdapter";
import { validateTeacherMaterial } from "../src/features/mona-vnext/teacher/materialGate";

const entries = listMonaVnextGeneratedExpressionEntries();
const result = validateTeacherMaterial(entries.map(monaExpressionToTeacherMaterialCandidate));

function reasonCounts(items: Array<{ reasons: string[] }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    for (const reason of item.reasons) {
      acc[reason] = (acc[reason] ?? 0) + 1;
    }
    return acc;
  }, {});
}

console.log(`total=${entries.length}`);
console.log(`accepted=${result.accepted.length}`);
console.log(`quarantine=${result.quarantine.length}`);
console.log(`warnings=${result.warnings.length}`);
console.log(`quarantineReasons=${JSON.stringify(reasonCounts(result.quarantine))}`);
console.log(`warningReasons=${JSON.stringify(reasonCounts(result.warnings))}`);

for (const entry of result.quarantine) {
  console.log([
    "QUARANTINE",
    `id=${entry.expressionId}`,
    `reasons=${entry.reasons.join(",")}`,
    `ko=${entry.ko}`,
    `targetEn=${entry.targetEn}`,
  ].join(" | "));
}
