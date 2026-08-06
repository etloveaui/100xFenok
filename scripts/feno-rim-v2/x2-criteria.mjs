import crypto from "node:crypto"; import fs from "node:fs";
const C={
 schema_version:"feno_rim_v2_x2_success_criteria.v1",
 frozen_pre_result:true,
 freeze_policy:"frozen from the contract alone (section 6 X2 + section 10); the exploratory probe that preceded this used an ad-hoc V/P proxy, is labelled exploratory, and is NOT admissible to the confirmatory verdict",
 contract_ref:"FINAL_FENO_RIM_RESOLUTION_MASTER_PROMPT_QWEN_DEEPSEEK_KR.md section 6 (X2), section 9, section 10",
 handler:"cc",
 signal:{
  definition:"per-constituent V/P where V is the residual-income value from the SAME deployable path X3 uses (ROE fades linearly from the origin's realised ROE toward the constituent's trailing ROE-band midpoint over 3 years, retained-earnings book roll-forward, RI decaying linearly to zero over 10 further years), Ke = origin 10Y + restored US ERP",
  why:"reusing X3's deployable path means X2 and X3 measure the same model at different aggregation levels - the only difference under test is cross-section versus basket aggregate",
  no_ad_hoc_proxy:"no hand-built V/P expression; the value comes from the residual-income function"
 },
 baseline:{definition:"per-constituent book-to-price (B/P), the standard cheapness control",why:"contract section 6 X2 requires incremental IC over B/P, not just a positive IC"},
 minimum_survival:{
  mean_ic_positive:"mean cross-sectional Spearman IC > 0",
  ic_ci_excludes_zero:"block-bootstrap CI of the mean IC excludes zero",
  incremental_over_bp:"mean IC of V/P > mean IC of B/P on the same origins",
  consistency:"positive on both origin sets (all origins and window-complete)",
  min_names:"at least 20 valid constituents per scored origin"
 },
 decisive_origin_set:"reported on both; a verdict requires both to agree in sign",
 anti_loop:{no_threshold_movement_after_results:true,prior_verdicts_preserved:true,no_fifth_experiment:true}
};
const sha=crypto.createHash("sha256").update(JSON.stringify(C)).digest("hex");
const out="/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok/data/computed/feno-rim-v2/x2-success-criteria.json";
fs.writeFileSync(out,JSON.stringify({...C,criteria_sha256:sha},null,2)+"\n");
console.log("x2 criteria frozen\nsha256:",sha);
