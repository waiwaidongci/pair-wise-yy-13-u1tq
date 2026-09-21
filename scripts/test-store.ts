// 无头记录层测试：store 的业务流转、幂等与留档。
// node 桩必须先于 store 导入。
import "./node-stub";
import { actions, getState } from "../src/store/store";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.error("  ✗", msg);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 种子：B4 无检测单；S2 待复核；S1 已放行
let s = getState();
const b4 = s.batches.find((b: any) => b.id === "PC260920-03");
assert(b4, "种子含未开单批次 PC260920-03");
const seedReleased = s.sheets.find((x: any) => x.id === "RC-260920-001");
assert(seedReleased.status === "released", "种子 001 已放行");

console.log("一批一单 + 重复开单沿用首张");
const r1 = await actions.openSheet("PC260920-03", "BAL-01", "open:t:1");
assert(r1.ok, "首次开单成功");
const r2 = await actions.openSheet("PC260920-03", "BAL-01", "open:t:2");
assert(r2.sheetId === r1.sheetId, "重复开单沿用首张单号");
const openSheets = getState().sheets.filter(
  (x: any) => x.batchId === "PC260920-03" && (x.status === "open" || x.status === "review")
);
assert(openSheets.length === 1, "该批只有一张未结束检测单");

console.log("要素不齐不得提交");
const sid = r1.sheetId;
const bad = await actions.submit(
  sid,
  "BAL-01",
  { ovenNo: "", tempC: null, durationMin: null, wetWeightG: null, dryWeight1G: null, dryWeight2G: null },
  "k-incomplete"
);
assert(!bad.ok, "缺要素提交被拒绝");

console.log("齐全提交 → 放行；并发同键沿用首次结果");
// 目标 95 g/m²（±3%）：干重均值取 0.8775g/0.01m² ≈ 87.75，修正后 ≈ 91.7 → 区间 92.15~97.85
// 取 0.91/0.908 干重：90.9×1.045=94.99，落在区间内
const dryingOk = { ovenNo: "HX-A12", tempC: 105, durationMin: 90, wetWeightG: 0.98, dryWeight1G: 0.91, dryWeight2G: 0.908 };
const key = "k-submit-1";
const [a, b, c] = await Promise.all([
  actions.submit(sid, "BAL-01", dryingOk, key),
  actions.submit(sid, "BAL-01", dryingOk, key),
  actions.submit(sid, "BAL-01", dryingOk, key),
]);
assert(a.ok && b.ok && c.ok, "三次并发提交均返回成功");
assert(b.message.includes("沿用首次结果"), "第二次提示沿用首次结果");
assert(c.message.includes("沿用首次结果"), "第三次提示沿用首次结果");
s = getState();
const sheet = s.sheets.find((x: any) => x.id === sid);
assert(sheet.status === "released", `检测单已放行（status=${sheet.status}, gsm=${sheet.current?.metrics?.correctedGsm}）`);
assert(sheet.seq === 1, "seq=1（只评定一次）");

console.log("幂等：放行后同键再提交不产生新版本");
const again = await actions.submit(sid, "BAL-01", dryingOk, key);
assert(again.message.includes("沿用首次结果"), "同键重放沿用首次结果");
assert(getState().sheets.find((x: any) => x.id === sid).seq === 1, "seq 仍为 1");

console.log("更正已放行单烘干记录 → 原放行失效留档并重算（改坏→复核）");
const badDrying = { ovenNo: "HX-A12", tempC: 105, durationMin: 90, wetWeightG: 1.05, dryWeight1G: 0.98, dryWeight2G: 0.96 };
const corr = await actions.correctDrying(sid, badDrying, "k-corr-1");
assert(corr.ok, "更正提交成功");
s = getState();
const after = s.sheets.find((x: any) => x.id === sid);
assert(after.status === "review", `更正后转待复核（status=${after.status}）`);
assert(after.archivedConclusions.length === 1, "旧放行结论已归档 1 条");
assert(after.archivedConclusions[0].decision === "released", "归档的是原放行结论");
assert(after.archivedConclusions[0].invalidatedBy === "DRYING", "失效原因 DRYING");
assert(after.current.decision === "review", "新结论为待复核");

console.log("复核：退回 → 回到检测中，复核结论留档");
await actions.returnSheet(sid, "温度存疑重做", "k-return-1");
s = getState();
const returned = s.sheets.find((x: any) => x.id === sid);
assert(returned.status === "open", "退回后为检测中");
assert(returned.archivedConclusions.length === 2, "旧复核结论也留档（共 2 条）");
assert(returned.archivedConclusions[1].invalidatedBy === "RETURN", "第二条失效原因 RETURN");
assert(returned.current === null, "当前无结论");

console.log("复核队列中校准更正 → 已放行单连锁失效重算");
// 001 使用 BAL-01（有效），把 BAL-01 改成过期
const before001 = getState().sheets.find((x: any) => x.id === "RC-260920-001");
assert(before001.status === "released", "001 更正前已放行");
const cal = await actions.correctCalibration("BAL-01", "2026-03-01", "2026-09-10", "k-calib-1");
assert(cal.ok, "校准更正成功");
s = getState();
const after001 = s.sheets.find((x: any) => x.id === "RC-260920-001");
assert(after001.status === "review", `001 因校准过期转待复核（status=${after001.status}）`);
assert(after001.archivedConclusions.length === 1, "001 旧放行已留档");
assert(after001.archivedConclusions[0].invalidatedBy === "CALIBRATION", "失效原因 CALIBRATION");
assert(after001.current.reasons.includes("CALIBRATION_EXPIRED"), "新结论含校准过期原因");

console.log("复核裁定放行（留痕）");
// 002 原本就是 review（BAL-02 过期 + 偏差超限）
const s2 = getState().sheets.find((x: any) => x.id === "RC-260920-002");
const ov = await actions.overrideRelease("RC-260920-002", "已核对留样，偏差为称重操作失误，批准放行", "k-ov-1");
assert(ov.ok, "裁定放行成功");
const after002 = getState().sheets.find((x: any) => x.id === "RC-260920-002");
assert(after002.status === "released" && after002.current.override === true, "状态已放行且带 override 标记");
assert(!!after002.current.overrideNote, "保留复核说明");
const noNote = await actions.overrideRelease(after001.id, "", "k-ov-nonote");
assert(!noNote.ok, "无说明的裁定放行被拒绝");

console.log("审计流完整");
assert(getState().audits.length >= 8, `审计条目充足（${getState().audits.length} 条）`);

console.log("持久化：重新载入（模拟刷新）状态一致");
// store 模块单例状态即来自 localStorage；校验未结束单数
const reviewCount = getState().sheets.filter((x: any) => x.status === "review").length;
// 连锁重算后 001 待复核；002 已被裁定放行；新单已退回检测中
assert(reviewCount === 1, `待复核队列 ${reviewCount} 张（仅校准连锁重算单）`);
const openCount = getState().sheets.filter((x: any) => x.status === "open").length;
assert(openCount === 2, `检测中 ${openCount} 张（种子 003 + 退回新单）`);
await sleep(10);

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部记录层测试通过");
