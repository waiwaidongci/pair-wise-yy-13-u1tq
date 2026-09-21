// 规则层：放行规则与评定引擎。
// 纯函数、无副作用；规则常量集中承载，页面与记录层均不得内联业务判定。
import type {
  Balance,
  Batch,
  Conclusion,
  Decision,
  DryingRecord,
  Metrics,
  ReasonCode,
} from "./types";

/** 规则版本：规则调整后递增，历史结论保留其产生时的版本号 */
export const RULE_VERSION = 1;

/** 两次称重相对偏差上限（%）：|d1-d2| / 均值，超过 0.5% 只进待复核 */
export const DEVIATION_LIMIT_PCT = 0.5;

/** 修正克重默认允许偏差（%），批次可单独配置 gsmTolerancePct */
export const DEFAULT_GSM_TOLERANCE_PCT = 3;

/** 烘干记录必须齐全的字段（空值/未填视为要素不齐，不得提交放行） */
export const REQUIRED_DRYING_FIELDS: { key: keyof DryingRecord; label: string }[] = [
  { key: "ovenNo", label: "烘箱编号" },
  { key: "tempC", label: "烘干温度" },
  { key: "durationMin", label: "烘干时长" },
  { key: "wetWeightG", label: "烘前初重" },
  { key: "dryWeight1G", label: "第一次称重" },
  { key: "dryWeight2G", label: "第二次称重" },
];

export const REASON_LABELS: Record<ReasonCode, string> = {
  INCOMPLETE: "检测要素不齐全（温度/时长/烘箱编号/两次称重须齐全）",
  CALIBRATION_EXPIRED: "天平校准过期，只进待复核，不得放行克重",
  WEIGH_DEVIATION: `两次称重偏差超过 ${DEVIATION_LIMIT_PCT}%，只进待复核`,
  NONPOSITIVE: "重量/数值必须大于 0",
  WET_LT_DRY: "烘前初重小于干重，称重数据异常",
  GSM_OUT_OF_RANGE: "修正克重偏离目标允许区间，需复核裁定",
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 校准是否有效：有效期当日仍有效，次日起过期 */
export function isCalibrationValid(balance: Pick<Balance, "validUntil">, today: string): boolean {
  return today <= balance.validUntil;
}

/** 计算缺失的必填字段名 */
export function missingFields(drying: DryingRecord): string[] {
  const missing: string[] = [];
  for (const { key, label } of REQUIRED_DRYING_FIELDS) {
    const v = drying[key];
    if (v === null || v === "" || (typeof v === "number" && Number.isNaN(v))) {
      missing.push(label);
    }
  }
  return missing;
}

/**
 * 回潮率与克重计算：
 * 实测回潮率(%) = (湿重 - 干重) / 干重 × 100
 * 干态克重 g/m² = 干重(g) / 取样面积(m²)
 * 修正克重 g/m² = 干态克重 × (1 + 公称回潮率/100)
 */
export function computeMetrics(drying: DryingRecord, batch: Batch): Metrics | null {
  const w = drying.wetWeightG;
  const d1 = drying.dryWeight1G;
  const d2 = drying.dryWeight2G;
  if (w === null || d1 === null || d2 === null) return null;

  const avgDry = (d1 + d2) / 2;
  const areaM2 = batch.sampleAreaDm2 / 100; // 1 dm² = 0.01 m²
  return {
    deviationPct: round4((Math.abs(d1 - d2) / avgDry) * 100),
    regainPct: round2(((w - avgDry) / avgDry) * 100),
    dryGsm: round2(avgDry / areaM2),
    correctedGsm: round2((avgDry / areaM2) * (1 + batch.nominalRegainPct / 100)),
  };
}

export interface EvaluateInput {
  drying: DryingRecord;
  batch: Batch;
  balance: Pick<Balance, "id" | "validUntil">;
  today: string;
  operator: string;
}

/**
 * 规则引擎：要素齐全且全部通过才放行克重；
 * 天平校准过期或两次偏差超 0.5%（及其余异常）一律只进待复核。
 */
export function evaluate(input: EvaluateInput): Conclusion {
  const { drying, batch, balance, today, operator } = input;
  const reasons: ReasonCode[] = [];
  const decidedAt = new Date().toISOString();

  if (missingFields(drying).length > 0) {
    reasons.push("INCOMPLETE");
  }

  const nums = [
    drying.wetWeightG,
    drying.dryWeight1G,
    drying.dryWeight2G,
    drying.tempC,
    drying.durationMin,
  ];
  const hasNonPositive = nums.some((n) => n !== null && (!Number.isFinite(n) || n <= 0));
  if (hasNonPositive) reasons.push("NONPOSITIVE");

  const calibrationValid = isCalibrationValid(balance, today);
  if (!calibrationValid) reasons.push("CALIBRATION_EXPIRED");

  const metrics = computeMetrics(drying, batch);
  if (metrics) {
    if (metrics.deviationPct > DEVIATION_LIMIT_PCT) reasons.push("WEIGH_DEVIATION");
    if ((drying.wetWeightG ?? 0) < (drying.dryWeight1G ?? Infinity)) reasons.push("WET_LT_DRY");

    const lower = batch.targetGsm * (1 - batch.gsmTolerancePct / 100);
    const upper = batch.targetGsm * (1 + batch.gsmTolerancePct / 100);
    if (metrics.correctedGsm < lower || metrics.correctedGsm > upper) {
      reasons.push("GSM_OUT_OF_RANGE");
    }
  }

  const decision: Decision = reasons.length === 0 ? "released" : "review";
  return {
    decision,
    reasons,
    metrics,
    ruleVersion: RULE_VERSION,
    decidedAt,
    decidedBy: operator,
  };
}

/** 将旧结论标记为失效并归档（不删除、不改写原数值） */
export function invalidateConclusion(
  conclusion: Conclusion,
  by: NonNullable<Conclusion["invalidatedBy"]>,
  at: string
): Conclusion {
  return { ...conclusion, invalidatedBy: by, invalidatedAt: at };
}
