// Precision gate for Fenok RIM outputs.
//
// This module does not choose model inputs or fit parameters. It only prevents
// the pipeline from publishing more precision than its dated evidence supports.
// In particular, a lower-bound statement is never converted into a point or a
// pseudo-range upper edge.

function finite(value) {
  return Number.isFinite(value);
}

function nullVerdict(reasons) {
  return { status: "NULL", reasons };
}

export function classifyRimPublication({
  identity_status: identityStatus,
  inputs,
  holdout,
  fitted_relations: fittedRelations = [],
  sweep = null,
}) {
  const reasons = [];

  if (identityStatus !== "verified") {
    reasons.push("asset_identity_unverified");
  }

  if (!Array.isArray(inputs) || inputs.length === 0) {
    reasons.push("material_inputs_missing");
  } else {
    for (const input of inputs) {
      const name = input?.name ?? "unknown";
      if (input?.observable !== true || input?.kind === "latent") {
        reasons.push(`material_input_latent:${name}`);
        continue;
      }
      if (input?.current !== true) {
        reasons.push(`material_input_stale:${name}`);
      }
      if (input?.kind === "range") {
        if (!finite(input.lower) || !finite(input.upper) || input.lower > input.upper) {
          reasons.push(`material_input_range_invalid:${name}`);
        }
      } else if (input?.kind !== "point") {
        reasons.push(`material_input_unbounded:${name}`);
      }
    }
  }

  for (const relation of fittedRelations) {
    if (relation?.inside_domain !== true) {
      reasons.push(`fitted_relation_outside_domain:${relation?.name ?? "unknown"}`);
    }
  }

  const boundedHoldout = holdout?.kind === "point" || holdout?.kind === "range";
  if (!boundedHoldout) {
    reasons.push("bounded_non_floor_holdout_required");
  } else if (holdout.passed !== true) {
    reasons.push("bounded_holdout_failed");
  }

  if (reasons.length > 0) return nullVerdict(reasons);

  const hasRangedInput = inputs.some((input) => input.kind === "range");
  if (hasRangedInput) {
    if (
      sweep?.complete !== true
      || !finite(sweep.lower)
      || !finite(sweep.upper)
      || sweep.lower > sweep.upper
    ) {
      return nullVerdict(["complete_bound_sweep_required"]);
    }
    return { status: "RANGE", reasons: [] };
  }

  return { status: "POINT", reasons: [] };
}
