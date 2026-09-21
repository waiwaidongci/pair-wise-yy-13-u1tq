// 记录层：唯一事实来源（localStorage 持久化）。
// - 所有写入串行化（Web Locks 跨标签互斥，不支持时退化为本机串行）
// - 幂等键：重复/并发提交沿用首次结果
// - 刷新与跨标签通过 storage 事件 + useSyncExternalStore 保持一致
import { useSyncExternalStore } from "react";

import { evaluate, invalidateConclusion } from "../domain/rules";
import type {
  AuditEntry,
  Balance,
  Batch,
  Conclusion,
  DryingRecord,
  IdemRecord,
  InspectionSheet,
  StationState,
} from "../domain/types";
import { buildSeedState, STORAGE_KEY } from "./seed";

export interface ActionResult {
  ok: boolean;
  message: string;
  sheetId?: string;
}

const IDEM_LIMIT = 500;

function load(): StationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StationState;
      if (parsed && Array.isArray(parsed.sheets)) return parsed;
    }
  } catch {
    /* 存储损坏时回退种子 */
  }
  const seed = buildSeedState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  } catch {
    /* 忽略写入失败 */
  }
  return seed;
}

let state: StationState = typeof localStorage === "undefined" ? buildSeedState() : load();
const listeners = new Set<() => void>();

function persist(next: StationState): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 配额失败时内存态仍更新 */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getState(): StationState {
  return state;
}

// 跨标签：其他标签提交后，以其写入的最新状态为准
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue) as StationState;
        listeners.forEach((fn) => fn());
      } catch {
        /* 忽略无法解析的更新 */
      }
    }
  });
}

function useStation<T>(selector: (s: StationState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state)
  );
}

// ---------- 纯工具 ----------

function nowIso(): string {
  return new Date().toISOString();
}

function today(): string {
  return nowIso().slice(0, 10);
}

let seqCounter = 0;
function uid(prefix: string): string {
  seqCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${seqCounter}`;
}

function addAudit(
  s: StationState,
  entry: Omit<AuditEntry, "id" | "at" | "operator"> & { operator?: string }
): void {
  s.audits.unshift({
    id: uid("A"),
    at: nowIso(),
    operator: entry.operator ?? s.operator,
    action: entry.action,
    sheetId: entry.sheetId,
    batchId: entry.batchId,
    detail: entry.detail,
    idemKey: entry.idemKey,
  });
}

function findRefs(s: StationState, sheetId: string) {
  const sheet = s.sheets.find((x) => x.id === sheetId);
  if (!sheet) throw new Error("检测单不存在");
  const batch = s.batches.find((b) => b.id === sheet.batchId);
  if (!batch) throw new Error("批次不存在");
  const balance = s.balances.find((x) => x.id === sheet.balanceId);
  if (!balance) throw new Error("天平不存在");
  return { sheet, batch, balance };
}

/** 以当前天平校准与批次规则重新评定检测单 */
function reevaluate(s: StationState, sheet: InspectionSheet): Conclusion {
  const batch = s.batches.find((b) => b.id === sheet.batchId)!;
  const balance = s.balances.find((x) => x.id === sheet.balanceId)!;
  return evaluate({
    drying: sheet.drying,
    batch,
    balance,
    today: today(),
    operator: s.operator,
  });
}

function archiveCurrent(sheet: InspectionSheet, by: Conclusion["invalidatedBy"]): void {
  if (sheet.current) {
    sheet.archivedConclusions.push(invalidateConclusion(sheet.current, by ?? "REEVALUATE", nowIso()));
  }
}

// ---------- 并发串行化 ----------

type Lockish = (name: string, cb: () => void | Promise<void>) => Promise<void>;

function withLock(fn: (fresh: StationState) => StationState | ActionResult): Promise<ActionResult> {
  const run = (): ActionResult => {
    // 进入临界区前以 localStorage 最新内容为准，避免跨标签陈旧状态
    const fresh = load();
    const draft: StationState = JSON.parse(JSON.stringify(fresh)) as StationState;
    const out = fn(draft);
    if (out && typeof out === "object" && "ok" in out) {
      // 业务失败不产生写入
      if (out.ok) {
        draft.revision += 1;
        persist(draft);
      }
      return out;
    }
    draft.revision += 1;
    persist(draft);
    return { ok: true, message: "已提交" };
  };

  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: Lockish }).locks : undefined;
  if (nav?.request) {
    return new Promise<ActionResult>((resolve, reject) => {
      nav
        .request("regain-release-station", () => {
          try {
            resolve(run());
          } catch (err) {
            reject(err);
          }
        })
        .catch(reject);
    });
  }
  return Promise.resolve(run());
}

/** 幂等：命中则沿用首次结果，不重复执行 */
function idemHit(s: StationState, key: string | undefined): ActionResult | null {
  if (!key) return null;
  const hit = s.idem.find((x) => x.key === key);
  if (hit) {
    return {
      ok: true,
      message: `重复/并发提交已沿用首次结果（${hit.at.slice(11, 19)}）`,
      sheetId: hit.result,
    };
  }
  return null;
}

function rememberIdem(s: StationState, key: string | undefined, sheetId: string): void {
  if (!key) return;
  const rec: IdemRecord = { key, at: nowIso(), result: sheetId };
  s.idem.unshift(rec);
  if (s.idem.length > IDEM_LIMIT) s.idem.length = IDEM_LIMIT;
}

// ---------- 动作 ----------

export const actions = {
  setOperator(name: string): Promise<ActionResult> {
    return withLock((s) => {
      s.operator = name.trim() || s.operator;
      return { ok: true, message: "已登记操作人" };
    });
  },

  addBatch(input: Omit<Batch, "createdAt">): Promise<ActionResult> {
    return withLock((s) => {
      if (s.batches.some((b) => b.id === input.id.trim())) {
        return { ok: false, message: "批号已存在" };
      }
      const batch: Batch = { ...input, id: input.id.trim(), createdAt: nowIso() };
      s.batches.unshift(batch);
      addAudit(s, {
        action: "ADD_BATCH",
        batchId: batch.id,
        detail: `登记批次 ${batch.id}（${batch.customer} / ${batch.fabric}，目标克重 ${batch.targetGsm} g/m²）`,
      });
      return { ok: true, message: `批次 ${batch.id} 已登记`, sheetId: batch.id };
    });
  },

  /** 同一批只允许一张未结束检测单；重复开具沿用首张 */
  openSheet(batchId: string, balanceId: string, idemKey?: string): Promise<ActionResult> {
    return withLock((s) => {
      const reused = s.sheets.find(
        (x) => x.batchId === batchId && (x.status === "open" || x.status === "review")
      );
      if (reused) {
        return {
          ok: true,
          message: `该批已有未结束检测单 ${reused.id}，沿用首张，未重复开单`,
          sheetId: reused.id,
        };
      }
      const hit = idemHit(s, idemKey);
      if (hit) return hit;

      const batch = s.batches.find((b) => b.id === batchId);
      if (!batch) return { ok: false, message: "批次不存在" };
      if (!s.balances.some((b) => b.id === balanceId)) {
        return { ok: false, message: "请选择有效天平" };
      }
      const sheet: InspectionSheet = {
        id: uid("RC"),
        batchId,
        status: "open",
        balanceId,
        drying: {
          ovenNo: "",
          tempC: null,
          durationMin: null,
          wetWeightG: null,
          dryWeight1G: null,
          dryWeight2G: null,
        },
        current: null,
        archivedConclusions: [],
        createdAt: nowIso(),
        createdBy: s.operator,
        seq: 0,
      };
      s.sheets.unshift(sheet);
      addAudit(s, {
        action: "OPEN_SHEET",
        sheetId: sheet.id,
        batchId,
        detail: `为批次 ${batchId} 开具检测单 ${sheet.id}`,
        idemKey,
      });
      rememberIdem(s, idemKey, sheet.id);
      return { ok: true, message: `已开具检测单 ${sheet.id}`, sheetId: sheet.id };
    });
  },

  saveDraft(sheetId: string, balanceId: string, drying: DryingRecord): Promise<ActionResult> {
    return withLock((s) => {
      const { sheet } = findRefs(s, sheetId);
      if (sheet.status === "released") {
        return { ok: false, message: "已放行检测单请使用“更正烘干记录”，留档重算" };
      }
      sheet.balanceId = balanceId;
      sheet.drying = drying;
      addAudit(s, {
        action: "SAVE_DRAFT",
        sheetId,
        batchId: sheet.batchId,
        detail: "暂存烘干与称重草稿（未评定）",
      });
      return { ok: true, message: "草稿已暂存" };
    });
  },

  /**
   * 提交评定：温度/时长/烘箱编号/两次称重须齐全；
   * 校准过期或偏差>0.5% 等 → 待复核，不得放行；全部通过 → 放行克重。
   */
  submit(
    sheetId: string,
    balanceId: string,
    drying: DryingRecord,
    idemKey: string
  ): Promise<ActionResult> {
    return withLock((s) => {
      const hit = idemHit(s, idemKey);
      if (hit) return hit;
      const { sheet, batch } = findRefs(s, sheetId);
      if (sheet.status === "released") {
        return { ok: false, message: "该单已放行；如需改动请走“更正烘干记录”" };
      }
      const balance = s.balances.find((b) => b.id === balanceId);
      if (!balance) return { ok: false, message: "请选择天平" };

      sheet.balanceId = balanceId;
      sheet.drying = JSON.parse(JSON.stringify(drying)) as DryingRecord;

      const conclusion = evaluate({ drying: sheet.drying, batch, balance, today: today(), operator: s.operator });
      if (conclusion.reasons.includes("INCOMPLETE")) {
        return { ok: false, message: "检测要素不齐全：烘箱编号、温度、时长、初重、两次称重缺一不可" };
      }

      // 重新评定（含待复核单补正后再提交）：旧结论留档
      if (sheet.current) archiveCurrent(sheet, "REEVALUATE");
      sheet.current = conclusion;
      sheet.seq += 1;
      sheet.status = conclusion.decision === "released" ? "released" : "review";

      addAudit(s, {
        action: "SUBMIT",
        sheetId,
        batchId: sheet.batchId,
        detail:
          conclusion.decision === "released"
            ? `规则评定通过，放行克重 ${conclusion.metrics?.correctedGsm ?? "-"} g/m²（实测回潮率 ${conclusion.metrics?.regainPct ?? "-"}%）`
            : `规则评定未通过（${conclusion.reasons.join("、")}），转待复核，不得放行克重`,
        idemKey,
      });
      rememberIdem(s, idemKey, sheetId);
      return {
        ok: true,
        message:
          conclusion.decision === "released"
            ? `评定通过：已放行克重 ${conclusion.metrics?.correctedGsm ?? ""} g/m²`
            : "已提交：只进待复核，不得放行克重",
        sheetId,
      };
    });
  },

  /** 复核台人工裁定放行（留痕 override） */
  overrideRelease(sheetId: string, note: string, idemKey: string): Promise<ActionResult> {
    return withLock((s) => {
      const hit = idemHit(s, idemKey);
      if (hit) return hit;
      const { sheet } = findRefs(s, sheetId);
      if (sheet.status !== "review" || !sheet.current) {
        return { ok: false, message: "仅待复核检测单可裁定放行" };
      }
      if (!note.trim()) return { ok: false, message: "裁定放行必须填写复核说明" };
      archiveCurrent(sheet, "REEVALUATE");
      sheet.current = {
        decision: "released",
        reasons: [],
        metrics: sheet.current.metrics,
        ruleVersion: sheet.current.ruleVersion,
        decidedAt: nowIso(),
        decidedBy: s.operator,
        override: true,
        overrideNote: note.trim(),
      };
      sheet.status = "released";
      sheet.seq += 1;
      addAudit(s, {
        action: "OVERRIDE_RELEASE",
        sheetId,
        batchId: sheet.batchId,
        detail: `复核裁定放行：${note.trim()}`,
        idemKey,
      });
      rememberIdem(s, idemKey, sheetId);
      return { ok: true, message: "复核裁定：已放行克重（留痕）", sheetId };
    });
  },

  /** 复核退回：回到检测中补做，旧复核结论留档 */
  returnSheet(sheetId: string, note: string, idemKey: string): Promise<ActionResult> {
    return withLock((s) => {
      const hit = idemHit(s, idemKey);
      if (hit) return hit;
      const { sheet } = findRefs(s, sheetId);
      if (sheet.status !== "review") return { ok: false, message: "仅待复核检测单可退回" };
      if (!note.trim()) return { ok: false, message: "退回必须填写原因" };
      archiveCurrent(sheet, "RETURN");
      sheet.current = null;
      sheet.status = "open";
      sheet.seq += 1;
      addAudit(s, {
        action: "RETURN",
        sheetId,
        batchId: sheet.batchId,
        detail: `复核退回检测：${note.trim()}`,
        idemKey,
      });
      rememberIdem(s, idemKey, sheetId);
      return { ok: true, message: "已退回检测中，补做后重新提交", sheetId };
    });
  },

  /**
   * 更正已放行单的烘干/称重记录：原放行立即失效、按规则重算，旧结论留档。
   */
  correctDrying(sheetId: string, drying: DryingRecord, idemKey: string): Promise<ActionResult> {
    return withLock((s) => {
      const hit = idemHit(s, idemKey);
      if (hit) return hit;
      const { sheet, batch } = findRefs(s, sheetId);
      const balance = s.balances.find((b) => b.id === sheet.balanceId)!;
      sheet.drying = JSON.parse(JSON.stringify(drying)) as DryingRecord;

      const conclusion = evaluate({ drying: sheet.drying, batch, balance, today: today(), operator: s.operator });
      if (conclusion.reasons.includes("INCOMPLETE")) {
        return { ok: false, message: "更正内容要素不齐全，不能提交" };
      }
      // 无论原状态如何，更正都使旧结论失效并归档
      if (sheet.current) archiveCurrent(sheet, "DRYING");
      sheet.current = conclusion;
      sheet.status = conclusion.decision === "released" ? "released" : "review";
      sheet.seq += 1;
      addAudit(s, {
        action: "SUBMIT",
        sheetId,
        batchId: sheet.batchId,
        detail:
          "更正烘干/称重记录，原放行已立即失效并按规则重算，旧结论已留档；重算结果：" +
          (conclusion.decision === "released"
            ? `放行 ${conclusion.metrics?.correctedGsm ?? "-"} g/m²`
            : `转待复核（${conclusion.reasons.join("、")}）`),
        idemKey,
      });
      rememberIdem(s, idemKey, sheetId);
      return {
        ok: true,
        message:
          conclusion.decision === "released"
            ? "已更正并重算：重新放行，旧结论已留档"
            : "已更正并重算：转为待复核，旧放行已失效留档",
        sheetId,
      };
    });
  },

  /**
   * 更正天平校准记录：所有使用该天平的已评定单原结论立即失效并重算。
   */
  correctCalibration(
    balanceId: string,
    calibratedOn: string,
    validUntil: string,
    idemKey: string
  ): Promise<ActionResult> {
    return withLock((s) => {
      const hit = idemHit(s, idemKey);
      if (hit) return hit;
      const balance = s.balances.find((b) => b.id === balanceId);
      if (!balance) return { ok: false, message: "天平不存在" };
      if (!calibratedOn || !validUntil) return { ok: false, message: "校准日期与有效期均必填" };
      if (validUntil < calibratedOn) return { ok: false, message: "有效期不能早于校准日期" };

      balance.calibratedOn = calibratedOn;
      balance.validUntil = validUntil;

      const affected = s.sheets.filter((x) => x.balanceId === balanceId && x.current);
      const flipped: string[] = [];
      for (const sheet of affected) {
        const before = sheet.status;
        archiveCurrent(sheet, "CALIBRATION");
        const conclusion = reevaluate(s, sheet);
        sheet.current = conclusion;
        sheet.status = conclusion.decision === "released" ? "released" : "review";
        sheet.seq += 1;
        if (sheet.status !== before) flipped.push(`${sheet.id}：${before}→${sheet.status}`);
      }

      addAudit(s, {
        action: "CORRECT_CALIBRATION",
        detail:
          `更正天平 ${balanceId} 校准记录（校准日 ${calibratedOn}，有效期至 ${validUntil}），` +
          `${affected.length} 张已评定单原结论立即失效并重算、旧结论留档` +
          (flipped.length ? `；状态翻转：${flipped.join("；")}` : "；结论状态无翻转"),
        idemKey,
      });
      rememberIdem(s, idemKey, balanceId);
      return {
        ok: true,
        message: `校准记录已更正，${affected.length} 张检测单已重算（旧结论留档）`,
      };
    });
  },

  resetDemo(): Promise<ActionResult> {
    return withLock((s) => {
      const fresh = buildSeedState();
      Object.assign(s, fresh);
      addAudit(s, {
        action: "RESET_DEMO",
        detail: "重置为演示数据",
        operator: "系统",
      });
      return { ok: true, message: "已重置为演示数据" };
    });
  },
};

export { getState, subscribe, today, uid, useStation };
export type { Balance, Batch, DryingRecord, InspectionSheet, StationState };
