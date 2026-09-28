import type { MonaVnextSessionExpressionBank } from "@/features/mona-vnext/coach/coachPolicy";
import {
  buildMonaVnextSessionExpressionBank,
  listMonaVnextGeneratedExpressionEntries,
} from "@/features/mona-vnext/server/expressionBank";
import { monaExpressionToTeacherMaterialCandidate } from "@/features/mona-vnext/teacher/teacherAdapter";
import { validateTeacherMaterial } from "@/features/mona-vnext/teacher/materialGate";
import type { TeacherMaterialGateResult } from "@/features/mona-vnext/teacher/teacherSession";

function materialGateMetadata(gate: TeacherMaterialGateResult) {
  return {
    materialQuarantine: gate.quarantine.map((entry) => ({
      expressionId: entry.expressionId,
      reasons: entry.reasons,
    })),
    materialWarnings: gate.warnings.map((entry) => ({
      expressionId: entry.expressionId,
      reasons: entry.reasons,
    })),
  };
}

export function listTeacherApprovedMonaVnextExpressionEntries() {
  const allEntries = listMonaVnextGeneratedExpressionEntries();
  const gate = validateTeacherMaterial(allEntries.map(monaExpressionToTeacherMaterialCandidate));
  const acceptedIds = new Set(gate.accepted.map((entry) => entry.expressionId));
  return {
    entries: allEntries.filter((entry) => acceptedIds.has(entry.id)),
    metadata: {
      source: "teacher-material-gate",
      sourceEntryCount: allEntries.length,
      acceptedCount: gate.accepted.length,
      ...materialGateMetadata(gate),
    },
  };
}

export function filterMonaVnextSessionExpressionBankForTeacher(
  expressionBank: MonaVnextSessionExpressionBank,
): MonaVnextSessionExpressionBank {
  const gate = validateTeacherMaterial(expressionBank.entries.map(monaExpressionToTeacherMaterialCandidate));
  const acceptedIds = new Set(gate.accepted.map((entry) => entry.expressionId));
  const entries = expressionBank.entries.filter((entry) => acceptedIds.has(entry.id));

  return {
    metadata: {
      ...expressionBank.metadata,
      selectedCount: entries.length,
      ...materialGateMetadata(gate),
    },
    entries,
  };
}

export function buildTeacherFilteredMonaVnextSessionExpressionBank(args: {
  seed: string;
  count?: number;
  prioritizedExpressionIds?: string[];
  deferredExpressionIds?: string[];
}): MonaVnextSessionExpressionBank {
  const approved = listTeacherApprovedMonaVnextExpressionEntries();
  return buildMonaVnextSessionExpressionBank({
    seed: args.seed,
    count: args.count,
    entries: approved.entries,
    prioritizedExpressionIds: args.prioritizedExpressionIds,
    deferredExpressionIds: args.deferredExpressionIds,
    metadata: {
      materialQuarantine: approved.metadata.materialQuarantine,
      materialWarnings: approved.metadata.materialWarnings,
    },
  });
}
