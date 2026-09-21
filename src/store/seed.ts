// 记录层：首次加载的演示种子数据。真实数据由 store 持久化在 localStorage。
import { evaluate } from "../domain/rules";
import type { Balance, Batch, InspectionSheet, StationState } from "../domain/types";

export const STORAGE_KEY = "regain-release-station:v1";

const TODAY = "2026-09-21";

export const SEED_BALANCES: Balance[] = [
  {
    id: "BAL-01",
    name: "电子天平 01（万分之一）",
    calibratedOn: "2026-08-25",
    validUntil: "2026-09-24",
  },
  {
    id: "BAL-02",
    name: "电子天平 02（百分之一）",
    calibratedOn: "2026-06-10",
    validUntil: "2026-09-10",
  },
];

export const SEED_BATCHES: Batch[] = [
  {
    id: "PC260918-01",
    customer: "华澜服饰",
    orderNo: "SO-88012",
    fabric: "棉府绸",
    nominalRegainPct: 8.5,
    targetGsm: 120,
    gsmTolerancePct: 3,
    sampleAreaDm2: 1,
    createdAt: "2026-09-18T08:30:00.000Z",
  },
  {
    id: "PC260918-02",
    customer: "宁远运动",
    orderNo: "SO-88037",
    fabric: "涤纶针织",
    nominalRegainPct: 0.4,
    targetGsm: 180,
    gsmTolerancePct: 3,
    sampleAreaDm2: 1,
    createdAt: "2026-09-18T09:05:00.000Z",
  },
  {
    id: "PC260919-05",
    customer: "锦澜家纺",
    orderNo: "SO-88105",
    fabric: "混纺斜纹",
    nominalRegainPct: 5.0,
    targetGsm: 240,
    gsmTolerancePct: 3,
    sampleAreaDm2: 1,
    createdAt: "2026-09-19T10:20:00.000Z",
  },
  {
    id: "PC260920-03",
    customer: "华澜服饰",
    orderNo: "SO-88141",
    fabric: "锦纶塔丝隆",
    nominalRegainPct: 4.5,
    targetGsm: 95,
    gsmTolerancePct: 3,
    sampleAreaDm2: 1,
    createdAt: "2026-09-20T14:00:00.000Z",
  },
];

export function buildSeedState(): StationState {
  const b1 = SEED_BATCHES[0];
  const b2 = SEED_BATCHES[1];
  const b3 = SEED_BATCHES[2];

  // 01：要素齐全、校准有效、偏差 0.36%、克重达标 → 已放行
  const c1 = evaluate({
    drying: {
      ovenNo: "HX-A12",
      tempC: 105,
      durationMin: 90,
      wetWeightG: 1.18,
      dryWeight1G: 1.107,
      dryWeight2G: 1.103,
    },
    batch: b1,
    balance: SEED_BALANCES[0],
    today: TODAY,
    operator: "检验员·林晓",
  });

  // 02：校准过期（天平02）+ 偏差 0.87% → 待复核
  const c2 = evaluate({
    drying: {
      ovenNo: "HX-B03",
      tempC: 103,
      durationMin: 120,
      wetWeightG: 1.82,
      dryWeight1G: 1.816,
      dryWeight2G: 1.80,
    },
    batch: b2,
    balance: SEED_BALANCES[1],
    today: TODAY,
    operator: "检验员·林晓",
  });

  const sheets: InspectionSheet[] = [
    {
      id: "RC-260920-001",
      batchId: b1.id,
      status: "released",
      balanceId: "BAL-01",
      drying: {
        ovenNo: "HX-A12",
        tempC: 105,
        durationMin: 90,
        wetWeightG: 1.18,
        dryWeight1G: 1.107,
        dryWeight2G: 1.103,
      },
      current: { ...c1, decidedAt: "2026-09-20T03:10:00.000Z" },
      archivedConclusions: [],
      createdAt: "2026-09-20T01:40:00.000Z",
      createdBy: "检验员·林晓",
      seq: 1,
    },
    {
      id: "RC-260920-002",
      batchId: b2.id,
      status: "review",
      balanceId: "BAL-02",
      drying: {
        ovenNo: "HX-B03",
        tempC: 103,
        durationMin: 120,
        wetWeightG: 1.82,
        dryWeight1G: 1.816,
        dryWeight2G: 1.8,
      },
      current: { ...c2, decidedAt: "2026-09-20T06:35:00.000Z" },
      archivedConclusions: [],
      createdAt: "2026-09-20T04:00:00.000Z",
      createdBy: "检验员·周萌",
      seq: 1,
    },
    {
      id: "RC-260921-003",
      batchId: b3.id,
      status: "open",
      balanceId: "BAL-01",
      // 检测中草稿：要素未齐（温度/时长未录），不能提交
      drying: {
        ovenNo: "HX-A12",
        tempC: null,
        durationMin: null,
        wetWeightG: 2.5,
        dryWeight1G: null,
        dryWeight2G: null,
      },
      current: null,
      archivedConclusions: [],
      createdAt: "2026-09-21T01:15:00.000Z",
      createdBy: "检验员·周萌",
      seq: 0,
    },
  ];

  return {
    revision: 1,
    balances: SEED_BALANCES,
    batches: SEED_BATCHES,
    sheets,
    audits: [
      {
        id: "A-SEED-1",
        at: "2026-09-20T01:40:00.000Z",
        operator: "检验员·林晓",
        action: "OPEN_SHEET",
        sheetId: "RC-260920-001",
        batchId: b1.id,
        detail: `为批次 ${b1.id} 开具检测单 RC-260920-001`,
      },
      {
        id: "A-SEED-2",
        at: "2026-09-20T03:10:00.000Z",
        operator: "检验员·林晓",
        action: "SUBMIT",
        sheetId: "RC-260920-001",
        batchId: b1.id,
        detail: "检测要素齐全，规则评定：放行克重 119.89 g/m²",
      },
      {
        id: "A-SEED-3",
        at: "2026-09-20T04:00:00.000Z",
        operator: "检验员·周萌",
        action: "OPEN_SHEET",
        sheetId: "RC-260920-002",
        batchId: b2.id,
        detail: `为批次 ${b2.id} 开具检测单 RC-260920-002`,
      },
      {
        id: "A-SEED-4",
        at: "2026-09-20T06:35:00.000Z",
        operator: "检验员·周萌",
        action: "SUBMIT",
        sheetId: "RC-260920-002",
        batchId: b2.id,
        detail: "天平校准过期且两次称重偏差超限，转待复核，不得放行克重",
      },
      {
        id: "A-SEED-5",
        at: "2026-09-21T01:15:00.000Z",
        operator: "检验员·周萌",
        action: "OPEN_SHEET",
        sheetId: "RC-260921-003",
        batchId: b3.id,
        detail: `为批次 ${b3.id} 开具检测单 RC-260921-003（检测中）`,
      },
    ],
    idem: [],
    operator: "检验员·林晓",
  };
}
