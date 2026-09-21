// 规则与记录仓冒烟测试（node 环境，mock localStorage）
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage;

import { evaluate } from "../src/rules/engine";
import type { Balance } from "../src/rules/types";
import { stationStore } from "../src/data/station";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const validBalance: Balance = {
  id: "TP-X", name: "X", calibratedOn: "2026-01-01", validUntil: "2026-12-31", officer: "t", history: [],
};
const expiredBalance: Balance = { ...validBalance, id: "TP-E", validUntil: "2026-01-01" };
const fullDrying = { temperatureC: "105", durationMin: "60", ovenNo: "HX-03" };

console.log("规则引擎：");
const ok = evaluate({
  drying: fullDrying,
  weigh: { wetG: "1.2", firstG: "1.100", secondG: "1.103", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
});
check("齐全+校准有效+偏差0.27% → 放行", ok.decision === "released" && ok.complete, JSON.stringify(ok.reasons));

const miss = evaluate({
  drying: { ...fullDrying, durationMin: "" },
  weigh: { wetG: "1.2", firstG: "1.1", secondG: "1.1", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
});
check("烘干时长缺失 → 检测中、不得判定", miss.decision === null && miss.missing.some((m) => m.text.includes("烘干时长")));

const noWeigh = evaluate({
  drying: fullDrying,
  weigh: { wetG: "1.2", firstG: "", secondG: "", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
});
check("两次称重缺失 → 两条缺项", noWeigh.decision === null && noWeigh.missing.filter((m) => m.text.includes("称重")).length === 2);

const dev = evaluate({
  drying: fullDrying,
  weigh: { wetG: "2.1", firstG: "2.000", secondG: "2.011", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
});
check("偏差 0.55% > 0.5% → 待复核", dev.decision === "review" && dev.deviationPct === 0.55, String(dev.deviationPct));

const boundary = evaluate({
  drying: fullDrying,
  weigh: { wetG: "2.1", firstG: "2.000", secondG: "2.010", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
});
check("偏差恰为 0.5%（边界）→ 放行", boundary.decision === "released" && boundary.deviationPct === 0.5);

const exp = evaluate({
  drying: fullDrying,
  weigh: { wetG: "2.1", firstG: "2.000", secondG: "2.001", areaM2: "0.01" },
  balance: expiredBalance,
  asOfDate: "2026-06-01",
});
check("校准过期（末日2026-01-01 < 判定日）→ 待复核", exp.decision === "review" && exp.calibrationValid === false);

const lastDay = evaluate({
  drying: fullDrying,
  weigh: { wetG: "2.1", firstG: "2.000", secondG: "2.001", areaM2: "0.01" },
  balance: { ...validBalance, validUntil: "2026-06-01" },
  asOfDate: "2026-06-01",
});
check("校准有效期末日当天仍有效", lastDay.decision === "released");

check("非法数值（温度=abc）→ 缺项报错", evaluate({
  drying: { ...fullDrying, temperatureC: "abc" },
  weigh: { wetG: "2.1", firstG: "2.0", secondG: "2.0", areaM2: "0.01" },
  balance: validBalance,
  asOfDate: "2026-06-01",
}).decision === null);

console.log("记录仓（种子 4 单：检测中/放行/偏差复核/校准复核）：");
const s0 = stationStore.getState();
check("种子：队列 2 单待复核", s0.sheets.filter((s) => s.status === "review").length === 2);
check("种子：1 单检测中、1 单已放行", s0.sheets.filter((s) => s.status === "open").length === 1 && s0.sheets.filter((s) => s.status === "released").length === 1);

// 一张未结束单的批次禁止再开单
const blocked = stationStore.createSheet("t-block", "P-2609-001", "TP-01");
check("一批一单：检测中批次开单被拒", blocked.ok === false);
const blockedReview = stationStore.createSheet("t-block2", "P-2609-003", "TP-01");
check("一批一单：待复核批次开单同样被拒", blockedReview.ok === false);
const canReopen = stationStore.createSheet("t-open", "P-2609-002", "TP-01");
check("已放行批次可另开新单", canReopen.ok === true && !!canReopen.sheetId);

// 资料不齐不得提交
const incomplete = stationStore.submitSheet("t-sub-miss", "S-2609-001", {});
check("资料不齐提交被拒", incomplete.ok === false && incomplete.message.includes("未齐全"));

// 补齐后提交（偏差 0.273%，TP-01 有效）→ 放行
const released = stationStore.submitSheet("t-sub-ok", "S-2609-001", {
  durationMin: "60", firstG: "1.100", secondG: "1.103",
});
check("补齐提交 → 放行", released.ok === true && stationStore.getState().sheets.find((s) => s.id === "S-2609-001")?.status === "released", released.message);

// 同 token 重复提交沿用首次结果
const dup = stationStore.submitSheet("t-sub-ok", "S-2609-001", { durationMin: "60", firstG: "1.100", secondG: "1.999" });
check("重复提交沿用首次结果（duplicate=true，结论不变）", dup.duplicate === true && stationStore.getState().sheets.find((s) => s.id === "S-2609-001")?.conclusion?.gsm === 110.15);

// 已结束单据再次提交 → 拒绝并提示沿用首次
const again = stationStore.submitSheet("t-sub-again", "S-2609-001", { durationMin: "90", firstG: "1.1", secondG: "1.1" });
check("已结束单再次提交被拒", again.ok === false && again.message.includes("沿用首次"));

// 更正烘干记录（改成使资料齐全但... 改成 90min 仍放行；先测原结论留档数量增加）
const beforeArchives = stationStore.getState().sheets.find((s) => s.id === "S-2609-001")!.archives.length;
const corr = stationStore.correctDrying("t-corr", "S-2609-001", { temperatureC: "105", durationMin: "90", ovenNo: "HX-03" });
const afterCorr = stationStore.getState().sheets.find((s) => s.id === "S-2609-001")!;
check("更正烘干：成功且旧结论留档", corr.ok === true && afterCorr.archives.length === beforeArchives + 1 && afterCorr.archives[0].decision === "released");
check("更正后重算：仍放行（数据未变判定）", afterCorr.status === "released");

// 更正校准 TP-01 为过期 → 联动所有 TP-01 已结束单据失效重算
const affectedBefore = stationStore.getState().sheets.filter((s) => s.balanceId === "TP-01" && s.status !== "open").length;
const cal = stationStore.correctCalibration("t-cal", "TP-01", { calibratedOn: "2025-01-01", validUntil: "2025-06-01", officer: "周敏" });
const after = stationStore.getState();
check("校准更正联动重算，影响单数正确", cal.ok === true && cal.affectedSheets === affectedBefore, `${cal.affectedSheets} vs ${affectedBefore}`);
check("原放行单 S-2609-001 / S-2609-002 立即失效转待复核", after.sheets.find((s) => s.id === "S-2609-001")?.status === "review" && after.sheets.find((s) => s.id === "S-2609-002")?.status === "review");
check("旧校准记录留档", after.balances.find((b) => b.id === "TP-01")!.history.length === 1);
check("失效旧结论在履历中标记 active=false", !after.history.find((h) => h.sheetId === "S-2609-002" && h.trigger === "提交检测")!.active);
check("每批当前仅一条生效履历", after.sheets.every((s) => after.history.filter((h) => h.sheetId === s.id && h.active).length === 1));

// 复核意见
const note = stationStore.addReviewNote("t-note", "S-2609-003", "请复称后更正");
check("复核意见入履历", note.ok === true && stationStore.getState().sheets.find((s) => s.id === "S-2609-003")?.reviewNote === "请复称后更正");

console.log(`\n${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
