import type {
  Balance,
  ConclusionSnapshot,
  DryingDraft,
  RuleReason,
  SheetStatus,
  TestSheet,
  WeighDraft,
} from "./types";

/**
 * 规则、记录、页面分开承载：
 * 本文件只承载业务规则，不读写存储、不依赖 React。
 */

export const RULE_VERSION = "RV-2026.09";
/** 两次称重结果允许的最大相对偏差（%） */
export const WEIGH_DEVIATION_LIMIT_PCT = 0.5;

/**
 * 放行前必须齐全的字段：
 * 烘干温度、烘干时长、烘箱编号、第一次称重、第二次称重（外加烘前湿重与试样面积用于回潮/克重计算）。
 */
export const REQUIRED_FIELD_LABELS: { key: string; label: string }[] = [
  { key: "drying.temperatureC", label: "烘干温度" },
  { key: "drying.durationMin", label: "烘干时长" },
  { key: "drying.ovenNo", label: "烘箱编号" },
  { key: "weigh.wetG", label: "烘前湿重" },
  { key: "weigh.firstG", label: "第一次称重" },
  { key: "weigh.secondG", label: "第二次称重" },
  { key: "weigh.areaM2", label: "试样面积" },
];

/** 规则明确点名的四项齐全性字段 */
export const CORE_COMPLETE_LABELS = ["烘干温度", "烘干时长", "烘箱编号", "两次称重"];

export interface EvaluationInput {
  drying: DryingDraft;
  weigh: WeighDraft;
  balance: Balance | undefined;
  /** 判定依据日期（yyyy-mm-dd），默认今天 */
  asOfDate?: string;
}

export interface EvaluationResult {
  complete: boolean;
  missing: RuleReason[];
  calibrationValid: boolean;
  deviationPct: number | null;
  deviationOverLimit: boolean | null;
  regainPct: number | null;
  gsm: number | null;
  reasons: RuleReason[];
  /** null 表示资料未齐全、检测单仍处于检测中 */
  decision: Exclude<SheetStatus, "open"> | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayString(): string {
  return toDateString(new Date());
}

/** 严格解析正数；空串、非数字、零、负数都不算有效数值 */
export function parsePositive(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 天平校准在判定日期当天是否仍有效（含有效期末日） */
export function isCalibrationValid(balance: Balance, asOfDate = todayString()): boolean {
  return balance.validUntil >= asOfDate;
}

/** 两次（干重）称重相对偏差，以第一次为基准，单位 % */
export function deviationOf(first: number, second: number): number {
  return round((Math.abs(second - first) / first) * 100, 3);
}

/** 回潮率 =（烘前湿重 − 干重）/ 干重 × 100，干重取两次均值 */
export function regainOf(wet: number, first: number, second: number): number {
  const dry = (first + second) / 2;
  return round(((wet - dry) / dry) * 100, 4);
}

/** 放行克重：干重均值 / 试样面积 */
export function gsmOf(first: number, second: number, area: number): number {
  return round((first + second) / 2 / area, 3);
}

function getFieldByKey(input: EvaluationInput, key: string): string {
  if (key.startsWith("drying.")) {
    return input.drying[key.slice(7) as keyof DryingDraft];
  }
  return input.weigh[key.slice(6) as keyof WeighDraft];
}

export function evaluate(input: EvaluationInput): EvaluationResult {
  const asOf = input.asOfDate ?? todayString();

  // 1. 齐全性：烘干温度、时长、烘箱编号和两次称重须齐全（数值项还须为正数）
  const missing: RuleReason[] = [];
  const checks: { key: string; label: string; numeric: boolean }[] = REQUIRED_FIELD_LABELS.map((f) => ({
    key: f.key,
    label: f.label,
    numeric: f.key !== "drying.ovenNo",
  }));

  for (const c of checks) {
    const raw = getFieldByKey(input, c.key).trim();
    if (raw === "") {
      missing.push({ code: "MISSING", text: `${c.label}未填写` });
    } else if (c.numeric && parsePositive(raw) === null) {
      missing.push({ code: "INVALID", text: `${c.label}须为正数` });
    }
  }

  const wet = parsePositive(input.weigh.wetG);
  const first = parsePositive(input.weigh.firstG);
  const second = parsePositive(input.weigh.secondG);
  const area = parsePositive(input.weigh.areaM2);

  const calibrationValid = input.balance ? isCalibrationValid(input.balance, asOf) : false;
  if (!input.balance) {
    missing.push({ code: "NO_BALANCE", text: "未选择称重天平" });
  }

  const complete = missing.length === 0;

  if (!complete) {
    return {
      complete: false,
      missing,
      calibrationValid,
      deviationPct: null,
      deviationOverLimit: null,
      regainPct: null,
      gsm: null,
      reasons: missing,
      decision: null, // 资料不齐，不得结束检测 / 放行
    };
  }

  // 数值在此时必然有效
  const wetN = wet as number;
  const firstN = first as number;
  const secondN = second as number;
  const areaN = area as number;

  // 2. 两次称重偏差
  const deviationPct = deviationOf(firstN, secondN);
  const deviationOverLimit = deviationPct > WEIGH_DEVIATION_LIMIT_PCT;

  const regainPct = regainOf(wetN, firstN, secondN);
  const gsm = gsmOf(firstN, secondN, areaN);

  const reasons: RuleReason[] = [];
  let decision: Exclude<SheetStatus, "open"> = "released";

  // 3. 天平校准过期 → 只进待复核，不得放行克重
  if (!calibrationValid) {
    reasons.push({
      code: "CALIB_EXPIRED",
      text: `天平校准已于 ${input.balance?.validUntil} 到期，只进待复核，不得放行克重`,
    });
    decision = "review";
  }

  // 4. 两次结果偏差超过 0.5% → 只进待复核
  if (deviationOverLimit) {
    reasons.push({
      code: "DEVIATION_OVER",
      text: `两次称重偏差 ${deviationPct}% 超过 ${WEIGH_DEVIATION_LIMIT_PCT}%，只进待复核，不得放行克重`,
    });
    decision = "review";
  }

  if (decision === "released") {
    reasons.push({
      code: "OK",
      text: `资料齐全、校准有效、偏差 ${deviationPct}% ≤ ${WEIGH_DEVIATION_LIMIT_PCT}%，准予按 ${gsm} g/m² 放行克重`,
    });
  }

  return {
    complete: true,
    missing: [],
    calibrationValid,
    deviationPct,
    deviationOverLimit,
    regainPct,
    gsm,
    reasons,
    decision,
  };
}

/** 由检测单与天平组装判定输入 */
export function sheetToInput(sheet: TestSheet, balance: Balance | undefined): EvaluationInput {
  return { drying: sheet.drying, weigh: sheet.weigh, balance };
}

/** 生成结论快照 */
export function toSnapshot(
  sheet: TestSheet,
  balance: Balance | undefined,
  result: EvaluationResult,
  decidedAt: string,
  trigger: string,
): ConclusionSnapshot {
  if (result.decision === null || result.deviationPct === null || result.regainPct === null || result.gsm === null) {
    throw new Error("资料未齐全，不能生成结论快照");
  }
  return {
    decision: result.decision,
    deviationPct: result.deviationPct,
    regainPct: result.regainPct,
    gsm: result.gsm,
    calibrationValid: result.calibrationValid,
    reasons: result.reasons,
    decidedAt,
    trigger,
    ruleVersion: RULE_VERSION,
  };
}

export const DECISION_LABEL: Record<SheetStatus, string> = {
  open: "检测中",
  review: "待复核",
  released: "已放行",
};

export function formatPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export function formatGsm(v: number | null): string {
  return v === null ? "—" : `${v} g/m²`;
}
