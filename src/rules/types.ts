// 领域模型：回潮检测与克重放行台

/** 检测单状态：检测中（未结束）/ 待复核 / 已放行 */
export type SheetStatus = "open" | "review" | "released";

export interface RuleReason {
  code: string;
  text: string;
}

/** 面料批次 */
export interface Batch {
  id: string;
  fabric: string;
  composition: string;
  /** 标称克重 g/m² */
  nominalGsm: number;
  orderNo: string;
  createdAt: string;
}

/** 天平校准档案 */
export interface CalibrationRecord {
  calibratedOn: string; // yyyy-mm-dd
  validUntil: string; // yyyy-mm-dd
  officer: string;
  correctedAt: string;
}

export interface Balance {
  id: string;
  name: string;
  calibratedOn: string;
  validUntil: string;
  officer: string;
  /** 被更正替换下来的旧校准记录 */
  history: CalibrationRecord[];
}

/** 烘干记录 */
export interface DryingDraft {
  temperatureC: string;
  durationMin: string;
  ovenNo: string;
}

/** 两次称重及回潮计算原始数据 */
export interface WeighDraft {
  /** 烘前湿重 g */
  wetG: string;
  /** 第一次称重（烘干后初称）g */
  firstG: string;
  /** 第二次称重（恒重复称）g */
  secondG: string;
  /** 试样面积 m² */
  areaM2: string;
}

/** 一次判定的结论快照 */
export interface ConclusionSnapshot {
  decision: Exclude<SheetStatus, "open">;
  /** 两次称重相对偏差 %（相对第一次） */
  deviationPct: number;
  /** 回潮率 % */
  regainPct: number;
  /** 放行克重 g/m² */
  gsm: number;
  calibrationValid: boolean;
  reasons: RuleReason[];
  decidedAt: string;
  trigger: string;
  ruleVersion: string;
}

/** 被更正替换、留档的旧结论 */
export interface ArchivedConclusion extends ConclusionSnapshot {
  archivedAt: string;
  archiveReason: string;
}

export interface TestSheet {
  id: string;
  batchId: string;
  balanceId: string;
  drying: DryingDraft;
  weigh: WeighDraft;
  status: SheetStatus;
  conclusion: ConclusionSnapshot | null;
  archives: ArchivedConclusion[];
  createdAt: string;
  decidedAt: string | null;
  reviewNote: string | null;
}

/** 检测履历条目（含已失效的旧结论留档） */
export interface HistoryEntry {
  id: string;
  sheetId: string;
  batchId: string;
  at: string;
  trigger: string;
  decision: SheetStatus;
  deviationPct: number | null;
  regainPct: number | null;
  gsm: number | null;
  reasons: RuleReason[];
  /** 当前生效的结论才为 true；旧结论留档行保持 false */
  active: boolean;
  note?: string;
}
