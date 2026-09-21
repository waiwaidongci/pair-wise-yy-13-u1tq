import {
  evaluate,
  sheetToInput,
  toSnapshot,
  todayString,
} from "../rules/engine";
import type {
  ArchivedConclusion,
  ConclusionSnapshot,
  DryingDraft,
  HistoryEntry,
  SheetStatus,
  TestSheet,
} from "../rules/types";
import { buildSeed, type ProcessedRecord, type StationState } from "./seed";

/**
 * 记录层：批次、天平、检测单、履历全部落在 localStorage（单一会话存储）。
 * 规则判定一律走 rules/engine；本层只负责读写、幂等与更正联动。
 */

const STORAGE_KEY = "moisture-station-v1";

type OpResultOk = {
  ok: true;
  duplicate: boolean;
  message: string;
  sheetId?: string;
  affectedSheets?: number;
};
type OpResultErr = {
  ok: false;
  duplicate: boolean;
  message: string;
};
export type OpResult = OpResultOk | OpResultErr;

export interface CreateBatchInput {
  fabric: string;
  composition: string;
  nominalGsm: number;
  orderNo: string;
}

export interface CalibrationInput {
  calibratedOn: string;
  validUntil: string;
  officer: string;
}

function loadState(): StationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StationState;
      if (parsed && Array.isArray(parsed.sheets) && Array.isArray(parsed.balances)) {
        return rederive(parsed);
      }
    }
  } catch {
    // 存储损坏则回退演示数据
  }
  const seeded = buildSeed();
  persist(seeded);
  return seeded;
}

function persist(state: StationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 容量或隐私模式失败时仅保留内存态
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function yymm(d = new Date()): string {
  return `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}`;
}

/** 刷新后结论与当前规则/记录保持一致：已决定的单据若不再满足原结论，立即失效重算 */
function rederive(state: StationState): StationState {
  let next = state;
  for (const sheet of state.sheets) {
    if (sheet.status === "open" || !sheet.conclusion) continue;
    const balance = next.balances.find((b) => b.id === sheet.balanceId);
    const result = evaluate(sheetToInput(sheet, balance));
    const cur = sheet.conclusion;
    const mismatch =
      result.decision === null ||
      result.decision !== cur.decision ||
      result.deviationPct !== cur.deviationPct ||
      result.regainPct !== cur.regainPct ||
      result.gsm !== cur.gsm ||
      result.calibrationValid !== cur.calibrationValid;
    if (mismatch) {
      next = applyDecision(next, sheet.id, "刷新一致性重算：记录与规则已变化", {
        archive: true,
        note: `刷新后与规则版本 ${cur.ruleVersion} 下的旧结论不一致`,
      });
    }
  }
  return next;
}

/**
 * 统一结论应用：旧结论归档留档、旧生效履历失效、按当前规则重算并生成新结论。
 * 若资料已不齐全，检测单回到检测中（旧结论仍归档留档）。
 */
function applyDecision(
  state: StationState,
  sheetId: string,
  trigger: string,
  opts: { archive: boolean; note?: string },
): StationState {
  const now = new Date().toISOString();
  let history = state.history.map((h) =>
    h.sheetId === sheetId && h.active ? { ...h, active: false } : h,
  );

  const sheets = state.sheets.map((sheet): TestSheet => {
    if (sheet.id !== sheetId) return sheet;

    let archives = sheet.archives;
    if (opts.archive && sheet.conclusion) {
      const archived: ArchivedConclusion = {
        ...sheet.conclusion,
        archivedAt: now,
        archiveReason: `${trigger}${opts.note ? `（${opts.note}）` : ""}`,
      };
      archives = [...archives, archived];
    }

    const balance = state.balances.find((b) => b.id === sheet.balanceId);
    const result = evaluate(sheetToInput(sheet, balance));

    if (result.decision === null) {
      // 资料不齐：回到检测中，不得放行
      const entry: HistoryEntry = {
        id: `H-${String(state.seq.history).padStart(4, "0")}`,
        sheetId: sheet.id,
        batchId: sheet.batchId,
        at: now,
        trigger,
        decision: "open",
        deviationPct: null,
        regainPct: null,
        gsm: null,
        reasons: result.missing,
        active: true,
        note: opts.note,
      };
      history = [...history, entry];
      return {
        ...sheet,
        status: "open",
        conclusion: null,
        decidedAt: null,
        archives,
        reviewNote: null,
      };
    }

    const snap: ConclusionSnapshot = toSnapshot(sheet, balance, result, now, trigger);
    const entry: HistoryEntry = {
      id: `H-${String(state.seq.history).padStart(4, "0")}`,
      sheetId: sheet.id,
      batchId: sheet.batchId,
      at: now,
      trigger,
      decision: snap.decision,
      deviationPct: snap.deviationPct,
      regainPct: snap.regainPct,
      gsm: snap.gsm,
      reasons: snap.reasons,
      active: true,
      note: opts.archive ? opts.note : undefined,
    };
    history = [...history, entry];
    return {
      ...sheet,
      status: snap.decision,
      conclusion: snap,
      decidedAt: now,
      archives,
      reviewNote: snap.decision === "review" ? sheet.reviewNote : null,
    };
  });

  const addedEntries = history.length - state.history.length;
  return {
    ...state,
    sheets,
    history,
    seq: { ...state.seq, history: state.seq.history + addedEntries },
  };
}

class StationStore {
  private state: StationState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = loadState();
  }

  getState = (): StationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(next: StationState): void {
    this.state = next;
    persist(next);
    this.listeners.forEach((l) => l());
  }

  /** 重复或并发提交沿用首次结果：同一 clientToken 永远返回首次应答，且不重复改记录 */
  private idempotent(token: string, run: () => OpResult): OpResult {
    const first = this.state.processed[token];
    if (first) {
      return { ...first, duplicate: true };
    }
    const result = run();
    const record: ProcessedRecord = {
      at: new Date().toISOString(),
      ok: result.ok,
      duplicate: false,
      message: result.message,
      sheetId: result.ok ? result.sheetId : undefined,
    };
    this.commit({ ...this.state, processed: { ...this.state.processed, [token]: record } });
    return result;
  }

  createBatch = (token: string, input: CreateBatchInput): OpResult =>
    this.idempotent(token, () => {
      const fabric = input.fabric.trim();
      const composition = input.composition.trim();
      const orderNo = input.orderNo.trim();
      if (!fabric || !composition || !orderNo) {
        return { ok: false, duplicate: false, message: "面料、成分与客户订单号须填写完整" };
      }
      if (!Number.isFinite(input.nominalGsm) || input.nominalGsm <= 0) {
        return { ok: false, duplicate: false, message: "标称克重须为正数" };
      }
      const n = this.state.seq.batch;
      const id = `P-${yymm()}-${String(n).padStart(3, "0")}`;
      const batch = {
        id,
        fabric,
        composition,
        nominalGsm: input.nominalGsm,
        orderNo,
        createdAt: new Date().toISOString(),
      };
      this.state = {
        ...this.state,
        batches: [...this.state.batches, batch],
        seq: { ...this.state.seq, batch: n + 1 },
      };
      // 新批次自动开一张检测单
      const sheetNo = this.state.seq.sheet;
      const sheetId = `S-${yymm()}-${String(sheetNo).padStart(3, "0")}`;
      const now = new Date().toISOString();
      const sheet: TestSheet = {
        id: sheetId,
        batchId: id,
        balanceId: this.state.balances[0]?.id ?? "",
        drying: { temperatureC: "", durationMin: "", ovenNo: "" },
        weigh: { wetG: "", firstG: "", secondG: "", areaM2: "0.01" },
        status: "open",
        conclusion: null,
        archives: [],
        createdAt: now,
        decidedAt: null,
        reviewNote: null,
      };
      const entry: HistoryEntry = {
        id: `H-${String(this.state.seq.history).padStart(4, "0")}`,
        sheetId,
        batchId: id,
        at: now,
        trigger: "新建检测单",
        decision: "open",
        deviationPct: null,
        regainPct: null,
        gsm: null,
        reasons: [],
        active: true,
      };
      this.state = {
        ...this.state,
        sheets: [...this.state.sheets, sheet],
        history: [...this.state.history, entry],
        seq: { ...this.state.seq, sheet: sheetNo + 1, history: this.state.seq.history + 1 },
      };
      return { ok: true, duplicate: false, message: `批次 ${id} 已建并自动开单 ${sheetId}`, sheetId };
    });

  createSheet = (token: string, batchId: string, balanceId: string): OpResult =>
    this.idempotent(token, () => {
      const batch = this.state.batches.find((b) => b.id === batchId);
      if (!batch) return { ok: false, duplicate: false, message: "批次不存在" };
      const balance = this.state.balances.find((b) => b.id === balanceId);
      if (!balance) return { ok: false, duplicate: false, message: "请选择有效天平" };
      // 同一批只有一张未结束检测单（检测中 / 待复核都算未结束）
      const unfinished = this.state.sheets.find(
        (s) => s.batchId === batchId && (s.status === "open" || s.status === "review"),
      );
      if (unfinished) {
        return {
          ok: false,
          duplicate: false,
          message: `该批已有未结束检测单 ${unfinished.id}（${unfinished.status === "open" ? "检测中" : "待复核"}），不能重复开单`,
        };
      }
      const n = this.state.seq.sheet;
      const sheetId = `S-${yymm()}-${String(n).padStart(3, "0")}`;
      const now = new Date().toISOString();
      const sheet: TestSheet = {
        id: sheetId,
        batchId,
        balanceId,
        drying: { temperatureC: "", durationMin: "", ovenNo: "" },
        weigh: { wetG: "", firstG: "", secondG: "", areaM2: "0.01" },
        status: "open",
        conclusion: null,
        archives: [],
        createdAt: now,
        decidedAt: null,
        reviewNote: null,
      };
      const entry: HistoryEntry = {
        id: `H-${String(this.state.seq.history).padStart(4, "0")}`,
        sheetId,
        batchId,
        at: now,
        trigger: "新建检测单",
        decision: "open",
        deviationPct: null,
        regainPct: null,
        gsm: null,
        reasons: [],
        active: true,
      };
      this.state = {
        ...this.state,
        sheets: [...this.state.sheets, sheet],
        history: [...this.state.history, entry],
        seq: { ...this.state.seq, sheet: n + 1, history: this.state.seq.history + 1 },
      };
      return { ok: true, duplicate: false, message: `检测单 ${sheetId} 已开`, sheetId };
    });

  submitSheet = (token: string, sheetId: string, patch: Partial<DryingDraft> & { wetG?: string; firstG?: string; secondG?: string; areaM2?: string; balanceId?: string }): OpResult =>
    this.idempotent(token, () => {
      const sheet = this.state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return { ok: false, duplicate: false, message: "检测单不存在" };
      if (sheet.status !== "open") {
        return {
          ok: false,
          duplicate: false,
          message: `检测单 ${sheetId} 已结束（${sheet.status === "released" ? "已放行" : "待复核"}），结论沿用首次提交结果`,
        };
      }

      const drying: DryingDraft = { ...sheet.drying };
      if (patch.temperatureC !== undefined) drying.temperatureC = patch.temperatureC;
      if (patch.durationMin !== undefined) drying.durationMin = patch.durationMin;
      if (patch.ovenNo !== undefined) drying.ovenNo = patch.ovenNo;
      const weigh = {
        wetG: patch.wetG ?? sheet.weigh.wetG,
        firstG: patch.firstG ?? sheet.weigh.firstG,
        secondG: patch.secondG ?? sheet.weigh.secondG,
        areaM2: patch.areaM2 ?? sheet.weigh.areaM2,
      };
      const balanceId = patch.balanceId ?? sheet.balanceId;
      const balance = this.state.balances.find((b) => b.id === balanceId);

      // 先在内存暂存补齐后的单据，再交给规则引擎
      const prepared: TestSheet = { ...sheet, drying, weigh, balanceId };
      const result = evaluate(sheetToInput(prepared, balance));
      if (!result.complete) {
        return {
          ok: false,
          duplicate: false,
          message: `资料未齐全，不能结束检测：${result.missing.map((m) => m.text).join("；")}`,
        };
      }

      this.state = {
        ...this.state,
        sheets: this.state.sheets.map((s) => (s.id === sheetId ? prepared : s)),
      };
      this.state = applyDecision(this.state, sheetId, "提交检测", { archive: false });
      const decided = this.state.sheets.find((s) => s.id === sheetId);
      if (decided?.status === "released") {
        return {
          ok: true,
          duplicate: false,
          sheetId,
          message: `提交成功：回潮率 ${decided.conclusion?.regainPct}%，按 ${decided.conclusion?.gsm} g/m² 放行克重`,
        };
      }
      return {
        ok: true,
        duplicate: false,
        sheetId,
        message: `提交成功：资料已入待复核队列，不得放行克重（${decided?.conclusion?.reasons.map((r) => r.text).join("；")}）`,
      };
    });

  /** 更正烘干记录：已结束的单据原结论立即失效并重算，旧结论留档 */
  correctDrying = (token: string, sheetId: string, drying: DryingDraft): OpResult =>
    this.idempotent(token, () => {
      const sheet = this.state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return { ok: false, duplicate: false, message: "检测单不存在" };
      this.state = {
        ...this.state,
        sheets: this.state.sheets.map((s) => (s.id === sheetId ? { ...s, drying } : s)),
      };
      if (sheet.status === "open") {
        return { ok: true, duplicate: false, sheetId, message: `烘干记录已更正（${sheetId} 仍在检测中）` };
      }
      this.state = applyDecision(this.state, sheetId, "更正烘干记录", {
        archive: true,
        note: "原放行/复核结论立即失效，按更正后记录重算",
      });
      const after = this.state.sheets.find((s) => s.id === sheetId);
      return {
        ok: true,
        duplicate: false,
        sheetId,
        message:
          after?.status === "released"
            ? `更正完成：原结论已留档失效，重算后按 ${after.conclusion?.gsm} g/m² 放行`
            : after?.status === "review"
              ? `更正完成：原结论已留档失效，重算后仍为待复核`
              : `更正完成：原结论已留档失效，资料不齐已退回检测中`,
      };
    });

  /** 更正天平校准：使用该天平的已结束单据全部立即失效并重算 */
  correctCalibration = (token: string, balanceId: string, input: CalibrationInput): OpResult =>
    this.idempotent(token, () => {
      const balance = this.state.balances.find((b) => b.id === balanceId);
      if (!balance) return { ok: false, duplicate: false, message: "天平不存在" };
      if (!input.calibratedOn || !input.validUntil) {
        return { ok: false, duplicate: false, message: "校准日期与有效截止日期须填写" };
      }
      if (input.validUntil < input.calibratedOn) {
        return { ok: false, duplicate: false, message: "有效截止日期不能早于校准日期" };
      }
      if (!input.officer.trim()) {
        return { ok: false, duplicate: false, message: "校准人须填写" };
      }
      const now = new Date().toISOString();
      const archivedRecord = {
        calibratedOn: balance.calibratedOn,
        validUntil: balance.validUntil,
        officer: balance.officer,
        correctedAt: now,
      };
      this.state = {
        ...this.state,
        balances: this.state.balances.map((b) =>
          b.id === balanceId
            ? {
                ...b,
                calibratedOn: input.calibratedOn,
                validUntil: input.validUntil,
                officer: input.officer.trim(),
                history: [archivedRecord, ...b.history],
              }
            : b,
        ),
      };
      const decided = this.state.sheets.filter(
        (s) => s.balanceId === balanceId && s.status !== "open",
      );
      for (const s of decided) {
        this.state = applyDecision(this.state, s.id, "校准记录更正重算", {
          archive: true,
          note: `天平 ${balanceId} 校准记录被更正，原结论立即失效`,
        });
      }
      return {
        ok: true,
        duplicate: false,
        affectedSheets: decided.length,
        message: `天平 ${balanceId} 校准已更正，${decided.length} 张已结束检测单原结论失效并完成重算（旧结论留档）`,
      };
    });

  addReviewNote = (token: string, sheetId: string, note: string): OpResult =>
    this.idempotent(token, () => {
      const sheet = this.state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return { ok: false, duplicate: false, message: "检测单不存在" };
      const text = note.trim();
      if (!text) return { ok: false, duplicate: false, message: "复核意见不能为空" };
      const now = new Date().toISOString();
      const entry: HistoryEntry = {
        id: `H-${String(this.state.seq.history).padStart(4, "0")}`,
        sheetId,
        batchId: sheet.batchId,
        at: now,
        trigger: "复核备注",
        decision: sheet.status,
        deviationPct: sheet.conclusion?.deviationPct ?? null,
        regainPct: sheet.conclusion?.regainPct ?? null,
        gsm: sheet.conclusion?.gsm ?? null,
        reasons: sheet.conclusion?.reasons ?? [],
        active: false,
        note: text,
      };
      this.state = {
        ...this.state,
        sheets: this.state.sheets.map((s) =>
          s.id === sheetId ? { ...s, reviewNote: text } : s,
        ),
        history: [...this.state.history, entry],
        seq: { ...this.state.seq, history: this.state.seq.history + 1 },
      };
      return { ok: true, duplicate: false, sheetId, message: "复核意见已记入检测履历" };
    });

  resetDemo = (): void => {
    const seeded = buildSeed();
    persist(seeded);
    this.state = seeded;
    this.listeners.forEach((l) => l());
  };
}

export const stationStore = new StationStore();

/** 复核队列（待复核单据，刷新后与存储一致） */
export function selectReviewQueue(state: StationState): TestSheet[] {
  return state.sheets.filter((s) => s.status === "review");
}

export function selectUnfinishedByBatch(state: StationState, batchId: string): TestSheet | undefined {
  return state.sheets.find(
    (s) => s.batchId === batchId && (s.status === "open" || s.status === "review"),
  );
}

export { todayString };
export type { SheetStatus };
