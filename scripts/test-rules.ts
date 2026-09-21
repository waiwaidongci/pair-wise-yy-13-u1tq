// 无头规则测试（不进页面）：node 经 esbuild 转译后执行。
import {
  computeMetrics,
  evaluate,
  isCalibrationValid,
  missingFields,
  DEVIATION_LIMIT_PCT,
} from "../src/domain/rules";
import type { Balance, Batch, DryingRecord } from "../src/domain/types";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log("  ✓", msg);
  } else {
    failures += 1;
    console.error("  ✗", msg);
  }
}
function approx(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

const batch: Batch = {
  id: "T1",
  customer: "c",
  orderNo: "o",
  fabric: "棉",
  nominalRegainPct: 8.5,
  targetGsm: 120,
  gsmTolerancePct: 3,
  sampleAreaDm2: 1,
  createdAt: "",
};
const goodBalance: Balance = { id: "B", name: "b", calibratedOn: "2026-09-01", validUntil: "2026-09-24" };
const expiredBalance: Balance = { ...goodBalance, validUntil: "2026-09-20" };
const goodDrying: DryingRecord = {
  ovenNo: "HX-1",
  tempC: 105,
  durationMin: 90,
  wetWeightG: 1.18,
  dryWeight1G: 1.107,
  dryWeight2G: 1.103,
};

console.log("校准有效期边界");
assert(isCalibrationValid(goodBalance, "2026-09-24") === true, "有效期当天仍有效");
assert(isCalibrationValid(goodBalance, "2026-09-25") === false, "次日过期");

console.log("齐全性");
assert(missingFields(goodDrying).length === 0, "六项齐全");
assert(
  missingFields({ ...goodDrying, ovenNo: "", dryWeight2G: null }).length === 2,
  "缺烘箱编号与第二次称重时报两项"
);

console.log("指标计算");
const m = computeMetrics(goodDrying, batch)!;
assert(approx(m.deviationPct, 0.3617, 0.001), `偏差=${m.deviationPct}% ≈ 0.3617% < ${DEVIATION_LIMIT_PCT}%`);
assert(approx(m.regainPct, 6.78, 0.01), `回潮率=${m.regainPct}% ≈ 6.78%`);
assert(approx(m.dryGsm, 110.5, 0.01), `干态克重=${m.dryGsm}`);
assert(approx(m.correctedGsm, 119.89, 0.01), `修正克重=${m.correctedGsm}`);

console.log("评定：全部通过 → 放行");
const pass = evaluate({ drying: goodDrying, batch, balance: goodBalance, today: "2026-09-21", operator: "t" });
assert(pass.decision === "released", "合格单放行");
assert(pass.reasons.length === 0, "无异常原因");

console.log("评定：偏差超 0.5% → 只进待复核");
const devBad = evaluate({
  drying: { ...goodDrying, dryWeight1G: 1.11, dryWeight2G: 1.10 },
  batch,
  balance: goodBalance,
  today: "2026-09-21",
  operator: "t",
});
assert(devBad.decision === "review", "偏差超限转复核");
assert(devBad.reasons.includes("WEIGH_DEVIATION"), "原因含 WEIGH_DEVIATION");

console.log("评定：校准过期 → 只进待复核");
const calBad = evaluate({
  drying: goodDrying,
  batch,
  balance: expiredBalance,
  today: "2026-09-21",
  operator: "t",
});
assert(calBad.decision === "review", "校准过期转复核");
assert(calBad.reasons.includes("CALIBRATION_EXPIRED"), "原因含 CALIBRATION_EXPIRED");

console.log("评定：要素不齐 → 不放行");
const incomplete = evaluate({
  drying: { ...goodDrying, tempC: null },
  batch,
  balance: goodBalance,
  today: "2026-09-21",
  operator: "t",
});
assert(incomplete.reasons.includes("INCOMPLETE"), "原因含 INCOMPLETE");
assert(incomplete.decision === "review", "引擎判定为 review（store 层另挡提交）");

console.log("评定：修正克重越界 → 待复核");
const gsmBad = evaluate({
  drying: { ...goodDrying, wetWeightG: 1.3, dryWeight1G: 1.22, dryWeight2G: 1.22 },
  batch,
  balance: goodBalance,
  today: "2026-09-21",
  operator: "t",
});
assert(gsmBad.decision === "review" && gsmBad.reasons.includes("GSM_OUT_OF_RANGE"), "克重超限转复核");

console.log("评定：初重小于干重 → 异常复核");
const weird = evaluate({
  drying: { ...goodDrying, wetWeightG: 1.0 },
  batch,
  balance: goodBalance,
  today: "2026-09-21",
  operator: "t",
});
assert(weird.reasons.includes("WET_LT_DRY"), "原因含 WET_LT_DRY");

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部规则测试通过");
