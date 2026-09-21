// 页面层：烘干与称重录入表单（检测台与“更正烘干”共用）。
import { useMemo } from "react";

import {
  computeMetrics,
  DEVIATION_LIMIT_PCT,
  isCalibrationValid,
  missingFields,
} from "../domain/rules";
import type { Balance, Batch, DryingRecord } from "../domain/types";
import { today } from "../store/store";

export interface DryingFormValue {
  balanceId: string;
  drying: DryingRecord;
}

interface Props {
  value: DryingFormValue;
  balances: Balance[];
  batch: Batch;
  onChange: (v: DryingFormValue) => void;
  disabled?: boolean;
  lockBalance?: boolean;
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function DryingForm({ value, balances, batch, onChange, disabled, lockBalance }: Props) {
  const t = today();
  const { drying, balanceId } = value;
  const balance = balances.find((b) => b.id === balanceId);
  const calibrationValid = balance ? isCalibrationValid(balance, t) : false;

  const missing = useMemo(() => missingFields(drying), [drying]);
  const preview = useMemo(() => computeMetrics(drying, batch), [drying, batch]);

  const set = (patch: Partial<DryingRecord>) => onChange({ ...value, drying: { ...drying, ...patch } });

  const deviationBad = preview !== null && preview.deviationPct > DEVIATION_LIMIT_PCT;

  return (
    <div className="drying-form">
      <label className={lockBalance ? "locked" : ""}>
        <span>称重天平{lockBalance ? "（原单天平，更改校准请到校准页）" : ""}</span>
        <select
          value={balanceId}
          disabled={disabled || lockBalance}
          onChange={(e) => onChange({ ...value, balanceId: e.target.value })}
        >
          <option value="">请选择天平</option>
          {balances.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · {b.name}
            </option>
          ))}
        </select>
        {balance ? (
          <small className={calibrationValid ? "hint-ok" : "hint-bad"}>
            校准有效期至 {balance.validUntil}
            {calibrationValid ? "（有效）" : " —— 已过期：提交后只进待复核"}
          </small>
        ) : null}
      </label>

      <div className="drying-grid">
        <label>
          <span>烘箱编号 *</span>
          <input
            list="oven-list"
            value={drying.ovenNo}
            disabled={disabled}
            placeholder="如 HX-A12"
            onChange={(e) => set({ ovenNo: e.target.value })}
          />
          <datalist id="oven-list">
            <option value="HX-A12" />
            <option value="HX-A07" />
            <option value="HX-B03" />
          </datalist>
        </label>
        <label>
          <span>烘干温度 ℃ *</span>
          <input
            type="number"
            value={drying.tempC ?? ""}
            disabled={disabled}
            placeholder="如 105"
            onChange={(e) => set({ tempC: numOrNull(e.target.value) })}
          />
        </label>
        <label>
          <span>烘干时长 min *</span>
          <input
            type="number"
            value={drying.durationMin ?? ""}
            disabled={disabled}
            placeholder="如 90"
            onChange={(e) => set({ durationMin: numOrNull(e.target.value) })}
          />
        </label>
        <label>
          <span>烘前初重 g *</span>
          <input
            type="number"
            step="0.001"
            value={drying.wetWeightG ?? ""}
            disabled={disabled}
            onChange={(e) => set({ wetWeightG: numOrNull(e.target.value) })}
          />
        </label>
        <label>
          <span>第一次称重 g *</span>
          <input
            type="number"
            step="0.001"
            value={drying.dryWeight1G ?? ""}
            disabled={disabled}
            onChange={(e) => set({ dryWeight1G: numOrNull(e.target.value) })}
          />
        </label>
        <label>
          <span>第二次称重 g *</span>
          <input
            type="number"
            step="0.001"
            value={drying.dryWeight2G ?? ""}
            disabled={disabled}
            onChange={(e) => set({ dryWeight2G: numOrNull(e.target.value) })}
          />
        </label>
      </div>

      <div className="live-preview">
        {missing.length > 0 ? (
          <p className="hint-bad">要素未齐：{missing.join("、")}（齐全前不得提交）</p>
        ) : (
          <p className="hint-ok">检测要素齐全，可提交规则评定</p>
        )}
        {preview ? (
          <div className="preview-grid">
            <span className={deviationBad ? "hint-bad" : "hint-ok"}>
              两次偏差 {preview.deviationPct}%（限 {DEVIATION_LIMIT_PCT}%）
              {deviationBad ? " → 只进待复核" : ""}
            </span>
            <span>实测回潮率 {preview.regainPct}%</span>
            <span>干态克重 {preview.dryGsm} g/m²</span>
            <span>
              修正克重 <b>{preview.correctedGsm}</b> g/m²（公称回潮 {batch.nominalRegainPct}%，目标{" "}
              {batch.targetGsm}±{batch.gsmTolerancePct}%）
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
