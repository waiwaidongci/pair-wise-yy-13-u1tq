import {
  evaluate,
  isCalibrationValid,
  sheetToInput,
  toDateString,
  toSnapshot,
} from "../rules/engine";
import type {
  Balance,
  Batch,
  ConclusionSnapshot,
  HistoryEntry,
  SheetStatus,
  TestSheet,
} from "../rules/types";

export interface StationState {
  batches: Batch[];
  balances: Balance[];
  sheets: TestSheet[];
  history: HistoryEntry[];
  seq: { batch: number; sheet: number; history: number };
  /** 已完成的幂等请求：clientToken -> 首次结果（重复/并发提交沿用） */
  processed: Record<string, ProcessedRecord>;
}

export interface ProcessedRecord {
  at: string;
  ok: boolean;
  duplicate: boolean;
  message: string;
  sheetId?: string;
}

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function emptyDrying() {
  return { temperatureC: "", durationMin: "", ovenNo: "" };
}
function emptyWeigh() {
  return { wetG: "", firstG: "", secondG: "", areaM2: "" };
}

function historyFromSnapshot(
  seq: number,
  sheet: TestSheet,
  snap: ConclusionSnapshot,
  active: boolean,
): HistoryEntry {
  return {
    id: `H-${String(seq).padStart(4, "0")}`,
    sheetId: sheet.id,
    batchId: sheet.batchId,
    at: snap.decidedAt,
    trigger: snap.trigger,
    decision: snap.decision,
    deviationPct: snap.deviationPct,
    regainPct: snap.regainPct,
    gsm: snap.gsm,
    reasons: snap.reasons,
    active,
  };
}

/** 演示种子：覆盖 检测中 / 已放行 / 偏差超限待复核 / 校准过期待复核 四种场景 */
export function buildSeed(): StationState {
  const balances: Balance[] = [
    {
      id: "TP-01",
      name: "电子天平 #1",
      calibratedOn: offsetDate(-160),
      validUntil: offsetDate(22),
      officer: "周敏",
      history: [],
    },
    {
      id: "TP-02",
      name: "电子天平 #2",
      calibratedOn: offsetDate(-200),
      validUntil: offsetDate(-9),
      officer: "周敏",
      history: [],
    },
    {
      id: "TP-03",
      name: "电子天平 #3",
      calibratedOn: offsetDate(-40),
      validUntil: offsetDate(145),
      officer: "李昂",
      history: [],
    },
  ];

  const batches: Batch[] = [
    { id: "P-2609-001", fabric: "棉府绸", composition: "100% 棉", nominalGsm: 120, orderNo: "SO-88012", createdAt: isoMinutesAgo(95) },
    { id: "P-2609-002", fabric: "涤纶针织布", composition: "100% 涤纶", nominalGsm: 180, orderNo: "SO-88031", createdAt: isoMinutesAgo(320) },
    { id: "P-2609-003", fabric: "锦纶泳布", composition: "80% 锦纶 / 20% 氨纶", nominalGsm: 200, orderNo: "SO-88045", createdAt: isoMinutesAgo(260) },
    { id: "P-2609-004", fabric: "棉锦斜纹", composition: "60% 棉 / 40% 锦纶", nominalGsm: 260, orderNo: "SO-88051", createdAt: isoMinutesAgo(180) },
  ];

  let histSeq = 0;
  const history: HistoryEntry[] = [];
  const pushHistory = (entry: Omit<HistoryEntry, "id">): HistoryEntry => {
    histSeq += 1;
    const full: HistoryEntry = { ...entry, id: `H-${String(histSeq).padStart(4, "0")}` };
    history.push(full);
    return full;
  };

  const mkOpen = (id: string, batchId: string, balanceId: string, drying: TestSheet["drying"], weigh: TestSheet["weigh"], createdMin: number): TestSheet => {
    const sheet: TestSheet = {
      id,
      batchId,
      balanceId,
      drying,
      weigh,
      status: "open",
      conclusion: null,
      archives: [],
      createdAt: isoMinutesAgo(createdMin),
      decidedAt: null,
      reviewNote: null,
    };
    pushHistory({
      sheetId: id,
      batchId,
      at: sheet.createdAt,
      trigger: "新建检测单",
      decision: "open",
      deviationPct: null,
      regainPct: null,
      gsm: null,
      reasons: [],
      active: true,
    });
    return sheet;
  };

  const mkDecided = (
    id: string,
    batchId: string,
    balanceId: string,
    drying: TestSheet["drying"],
    weigh: TestSheet["weigh"],
    createdMin: number,
    decidedMin: number,
    trigger: string,
  ): TestSheet => {
    const base: TestSheet = {
      id,
      batchId,
      balanceId,
      drying,
      weigh,
      status: "open",
      conclusion: null,
      archives: [],
      createdAt: isoMinutesAgo(createdMin),
      decidedAt: null,
      reviewNote: null,
    };
    pushHistory({
      sheetId: id,
      batchId,
      at: base.createdAt,
      trigger: "新建检测单",
      decision: "open",
      deviationPct: null,
      regainPct: null,
      gsm: null,
      reasons: [],
      active: false,
    });
    const balance = balances.find((b) => b.id === balanceId);
    const result = evaluate(sheetToInput(base, balance));
    if (!result.decision) throw new Error(`种子数据 ${id} 无法判定`);
    const snap = toSnapshot(base, balance, result, isoMinutesAgo(decidedMin), trigger);
    base.status = snap.decision;
    base.conclusion = snap;
    base.decidedAt = snap.decidedAt;
    if (snap.decision === "review") base.reviewNote = null;
    pushHistory(historyFromSnapshot(histSeq + 1, base, snap, true));
    return base;
  };

  const sheets: TestSheet[] = [
    // 检测中：烘干时长、两次称重缺失
    mkOpen(
      "S-2609-001",
      "P-2609-001",
      "TP-01",
      { temperatureC: "105", durationMin: "", ovenNo: "HX-03" },
      { wetG: "1.205", firstG: "", secondG: "", areaM2: "0.01" },
      90,
    ),
    // 已放行：偏差 0.179%，校准有效
    mkDecided(
      "S-2609-002",
      "P-2609-002",
      "TP-01",
      { temperatureC: "105", durationMin: "60", ovenNo: "HX-03" },
      { wetG: "1.234", firstG: "1.120", secondG: "1.122", areaM2: "0.01" },
      310,
      250,
      "提交检测",
    ),
    // 待复核：两次偏差 0.95% > 0.5%
    mkDecided(
      "S-2609-003",
      "P-2609-003",
      "TP-03",
      { temperatureC: "105", durationMin: "90", ovenNo: "HX-01" },
      { wetG: "2.100", firstG: "2.000", secondG: "2.019", areaM2: "0.01" },
      250,
      200,
      "提交检测",
    ),
    // 待复核：天平 TP-02 校准已过期
    mkDecided(
      "S-2609-004",
      "P-2609-004",
      "TP-02",
      { temperatureC: "110", durationMin: "45", ovenNo: "HX-02" },
      { wetG: "2.601", firstG: "2.598", secondG: "2.600", areaM2: "0.01" },
      170,
      120,
      "提交检测",
    ),
  ];

  return {
    batches,
    balances,
    sheets,
    history,
    seq: { batch: 5, sheet: 5, history: histSeq + 1 },
    processed: {},
  };
}

export function seedCalibrationSummary(state: StationState): string[] {
  return state.balances.map((b) => `${b.id} ${isCalibrationValid(b) ? "有效" : "过期"}`);
}
