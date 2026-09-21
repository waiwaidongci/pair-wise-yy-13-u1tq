// 领域类型：回潮检测与克重放行台
// 仅描述业务概念，不依赖 React 与存储实现。

/** 检测单生命周期状态：未结束 = open | review；已结束 = released */
export type SheetStatus = "open" | "review" | "released";

/** 规则引擎判定结果 */
export type Decision = "released" | "review";

/** 驳回/复核原因编码，用于规则页与履历展示 */
export type ReasonCode =
  | "INCOMPLETE" // 检测要素不齐全
  | "CALIBRATION_EXPIRED" // 天平校准过期
  | "WEIGH_DEVIATION" // 两次称重偏差超 0.5%
  | "NONPOSITIVE" // 重量数值非法
  | "WET_LT_DRY" // 初重小于干重，数据异常
  | "GSM_OUT_OF_RANGE"; // 修正克重偏离目标区间

/** 烘干与称重记录：四项要素 + 两次称重齐全后引擎才可判定 */
export interface DryingRecord {
  ovenNo: string; // 烘箱编号
  tempC: number | null; // 烘干温度 ℃
  durationMin: number | null; // 烘干时长 min
  wetWeightG: number | null; // 烘前初重（湿重）g
  dryWeight1G: number | null; // 第一次称重 g
  dryWeight2G: number | null; // 第二次称重 g
}

/** 天平 */
export interface Balance {
  id: string;
  name: string;
  calibratedOn: string; // 校准日期 yyyy-mm-dd
  validUntil: string; // 校准有效期至 yyyy-mm-dd（当日有效）
}

/** 批次 */
export interface Batch {
  id: string; // 批号
  customer: string; // 客户
  orderNo: string; // 客户订单号
  fabric: string; // 面料/品种
  /** 公称（标准约定）回潮率 %，用于克重修正 */
  nominalRegainPct: number;
  targetGsm: number; // 目标克重 g/m²
  gsmTolerancePct: number; // 放行允许偏差 %（规则项，可配置）
  sampleAreaDm2: number; // 取样面积 dm²（1 dm² = 0.01 m²）
  createdAt: string;
}

/** 已计算指标快照（数值四舍五入后存档） */
export interface Metrics {
  deviationPct: number; // 两次称重相对偏差，|d1-d2|/均值
  regainPct: number; // 实测回潮率 (湿-干)/干
  dryGsm: number; // 干态克重
  correctedGsm: number; // 修正到公称回潮率的克重
}

/** 放行结论（每次评估生成；更正后旧结论进入归档留档） */
export interface Conclusion {
  decision: Decision;
  reasons: ReasonCode[];
  metrics: Metrics | null;
  ruleVersion: number;
  decidedAt: string;
  decidedBy: string;
  /** 复核强制放行时为 true；引擎首次放行 / 自动重算为 false */
  override?: boolean;
  overrideNote?: string;
  /** 因哪次更正而失效归档：烘干更正 DRYING / 校准更正 CALIBRATION / 退回 RETURN / 重新评定 REEVALUATE */
  invalidatedBy?: "DRYING" | "CALIBRATION" | "RETURN" | "REEVALUATE";
  invalidatedAt?: string;
}

/** 检测单 */
export interface InspectionSheet {
  id: string;
  batchId: string;
  status: SheetStatus;
  balanceId: string;
  drying: DryingRecord;
  /** 当前生效结论（首次放行或最近一次评定） */
  current: Conclusion | null;
  /** 历史结论留档：旧放行/旧评定按时间顺序保存，不覆盖删除 */
  archivedConclusions: Conclusion[];
  createdAt: string;
  createdBy: string;
  /** 每次评定/修订自增，用于版本展示 */
  seq: number;
}

/** 操作履历条目（规则留痕：谁在何时做了什么） */
export interface AuditEntry {
  id: string;
  at: string;
  operator: string;
  action:
    | "OPEN_SHEET"
    | "SAVE_DRAFT"
    | "SUBMIT"
    | "OVERRIDE_RELEASE"
    | "RETURN"
    | "CORRECT_CALIBRATION"
    | "ADD_BATCH"
    | "RESET_DEMO";
  sheetId?: string;
  batchId?: string;
  detail: string;
  idemKey?: string;
}

/** 幂等记录：同一幂等键沿用首次结果 */
export interface IdemRecord {
  key: string;
  at: string;
  result: string;
}

/** 全量持久化记录 */
export interface StationState {
  revision: number;
  balances: Balance[];
  batches: Batch[];
  sheets: InspectionSheet[];
  audits: AuditEntry[];
  idem: IdemRecord[];
  operator: string;
}
