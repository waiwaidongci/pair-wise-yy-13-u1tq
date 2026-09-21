import { useMemo, useState } from "react";
import { newClientToken } from "../data/useStation";
import { stationStore } from "../data/station";
import type { StationState } from "../data/seed";
import {
  DECISION_LABEL,
  evaluate,
  formatGsm,
  formatPct,
  isCalibrationValid,
  sheetToInput,
  todayString,
  WEIGH_DEVIATION_LIMIT_PCT,
} from "../rules/engine";
import type { TestSheet } from "../rules/types";
import { fmtTime, Notice, StatusBadge } from "./ui";

interface Props {
  state: StationState;
  sheet: TestSheet;
  onNotify: (kind: "ok" | "err" | "dup", message: string) => void;
}

export function SheetPanel({ state, sheet, onNotify }: Props) {
  const batch = state.batches.find((b) => b.id === sheet.batchId);
  const [temperatureC, setTemperatureC] = useState(sheet.drying.temperatureC);
  const [durationMin, setDurationMin] = useState(sheet.drying.durationMin);
  const [ovenNo, setOvenNo] = useState(sheet.drying.ovenNo);
  const [wetG, setWetG] = useState(sheet.weigh.wetG);
  const [firstG, setFirstG] = useState(sheet.weigh.firstG);
  const [secondG, setSecondG] = useState(sheet.weigh.secondG);
  const [areaM2, setAreaM2] = useState(sheet.weigh.areaM2);
  const [balanceId, setBalanceId] = useState(sheet.balanceId);
  const [submitting, setSubmitting] = useState(false);
  const [localMsg, setLocalMsg] = useState<{ kind: "ok" | "err" | "dup"; text: string } | null>(null);

  const balance = state.balances.find((b) => b.id === balanceId);
  const decided = sheet.status !== "open";

  const preview = useMemo(() => {
    const draft: TestSheet = {
      ...sheet,
      drying: { temperatureC, durationMin, ovenNo },
      weigh: { wetG, firstG, secondG, areaM2 },
      balanceId,
    };
    return evaluate(sheetToInput(draft, balance));
  }, [sheet, temperatureC, durationMin, ovenNo, wetG, firstG, secondG, areaM2, balanceId, balance]);

  const flash = (kind: "ok" | "err" | "dup", text: string) => {
    setLocalMsg({ kind, text });
    onNotify(kind, text);
  };

  // 重复或并发提交：每次点击生成新令牌，连续快速点击只在首次提交后生效一次（按钮即时锁定）
  const submit = () => {
    if (submitting) {
      flash("dup", "该检测单已提交，重复/并发提交沿用首次结果，不重复计算");
      return;
    }
    setSubmitting(true);
    const token = newClientToken();
    const res = stationStore.submitSheet(token, sheet.id, {
      temperatureC,
      durationMin,
      ovenNo,
      wetG,
      firstG,
      secondG,
      areaM2,
      balanceId,
    });
    flash(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (!res.ok) setSubmitting(false);
  };

  const correct = () => {
    const res = stationStore.correctDrying(newClientToken(), sheet.id, {
      temperatureC,
      durationMin,
      ovenNo,
    });
    flash(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (res.ok) setSubmitting(false);
  };

  return (
    <section className="panel sheet-panel">
      <div className="heading">
        <div>
          <p>回潮检测 · 克重放行台</p>
          <h2>
            检测单 {sheet.id} <StatusBadge status={sheet.status} />
          </h2>
          <p className="muted small">
            {batch ? `${batch.fabric}（${batch.composition}）· ${batch.id} · 订单 ${batch.orderNo} · 标称 ${batch.nominalGsm} g/m²` : ""}
          </p>
        </div>
        <div className="heading-meta">
          <span className="muted small">建单 {fmtTime(sheet.createdAt)}</span>
          <span className="muted small">判定 {fmtTime(sheet.decidedAt)}</span>
        </div>
      </div>

      {localMsg && <Notice kind={localMsg.kind}>{localMsg.text}</Notice>}

      {decided && sheet.conclusion && <ConclusionBanner sheet={sheet} />}

      <div className="form-grid">
        <fieldset className="form-block">
          <legend>① 烘干记录</legend>
          <label>
            <span>烘干温度 ℃</span>
            <input value={temperatureC} inputMode="decimal" onChange={(e) => setTemperatureC(e.target.value)} />
          </label>
          <label>
            <span>烘干时长 min</span>
            <input value={durationMin} inputMode="decimal" onChange={(e) => setDurationMin(e.target.value)} />
          </label>
          <label>
            <span>烘箱编号</span>
            <input value={ovenNo} onChange={(e) => setOvenNo(e.target.value)} placeholder="如 HX-03" />
          </label>
          <p className="muted small rule-hint">温度、时长、烘箱编号须齐全，缺一项不得结束检测</p>
        </fieldset>

        <fieldset className="form-block">
          <legend>② 两次称重（g）与试样</legend>
          <label>
            <span>烘前湿重 g</span>
            <input value={wetG} inputMode="decimal" disabled={decided} onChange={(e) => setWetG(e.target.value)} />
          </label>
          <label>
            <span>第一次称重（初称）g</span>
            <input className={preview.deviationOverLimit === true ? "field-bad" : ""} value={firstG} inputMode="decimal" disabled={decided} onChange={(e) => setFirstG(e.target.value)} />
          </label>
          <label>
            <span>第二次称重（复称）g</span>
            <input className={preview.deviationOverLimit === true ? "field-bad" : ""} value={secondG} inputMode="decimal" disabled={decided} onChange={(e) => setSecondG(e.target.value)} />
          </label>
          <label>
            <span>试样面积 m²</span>
            <input value={areaM2} inputMode="decimal" disabled={decided} onChange={(e) => setAreaM2(e.target.value)} />
          </label>
          <p className="muted small rule-hint">
            两次称重相对偏差 ≤ {WEIGH_DEVIATION_LIMIT_PCT}% 方可放行，当前：
            <b className={preview.deviationOverLimit ? "text-bad" : "text-ok"}>
              {" "}{formatPct(preview.deviationPct)}
            </b>
            {decided ? "；称重记录已冻结，更正须走烘干/校准更正重算流程" : ""}
          </p>
        </fieldset>

        <fieldset className="form-block">
          <legend>③ 称重天平与校准</legend>
          <label>
            <span>天平</span>
            <select value={balanceId} disabled={decided} onChange={(e) => setBalanceId(e.target.value)}>
              <option value="">请选择天平</option>
              {state.balances.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {b.name}（{isCalibrationValid(b, todayString()) ? "校准有效" : "校准过期"}）
                </option>
              ))}
            </select>
          </label>
          {balance && (
            <div className={isCalibrationValid(balance) ? "cal-box ok" : "cal-box bad"}>
              <p>校准日期 {balance.calibratedOn}，有效至 {balance.validUntil}</p>
              <p>校准人 {balance.officer} · 今天 {todayString()}</p>
              <p>{isCalibrationValid(balance) ? "校准有效，可参与放行判定" : "校准已过期：只进待复核，不得放行克重"}</p>
            </div>
          )}
        </fieldset>

        <fieldset className="form-block live">
          <legend>④ 规则实时预览</legend>
          {!preview.complete ? (
            <div className="live-block">
              <h4>资料未齐全，检测单处于检测中</h4>
              <ul>
                {preview.missing.map((m) => (
                  <li key={m.text} className="text-bad">{m.text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="live-block">
              <div className="metric-line">
                <span>回潮率</span>
                <b>{formatPct(preview.regainPct)}</b>
              </div>
              <div className="metric-line">
                <span>两次偏差</span>
                <b className={preview.deviationOverLimit ? "text-bad" : "text-ok"}>{formatPct(preview.deviationPct)}</b>
              </div>
              <div className="metric-line">
                <span>放行克重</span>
                <b>{formatGsm(preview.gsm)}</b>
              </div>
              <ul className="reason-list">
                {preview.reasons.map((r) => (
                  <li key={r.code} className={r.code === "OK" ? "text-ok" : "text-bad"}>{r.text}</li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>
      </div>

      <div className="actions">
        {!decided && (
          <button className="primary" onClick={submit} disabled={submitting}>
            {submitting ? "已提交（重复点击沿用首次结果）" : "提交检测 · 结束并判定"}
          </button>
        )}
        {decided && (
          <button className="warn" onClick={correct}>
            更正烘干记录并重算（原{DECISION_LABEL[sheet.status]}立即失效，旧结论留档）
          </button>
        )}
        <span className="muted small">
          规则版本 {sheet.conclusion?.ruleVersion ?? "RV-2026.09"} · 判定日期 {fmtTime(sheet.conclusion?.decidedAt ?? null)}
        </span>
      </div>

      {sheet.archives.length > 0 && (
        <div className="archives">
          <h4>旧结论留档（{sheet.archives.length}）</h4>
          {sheet.archives.map((a, i) => (
            <div key={i} className="archive-item">
              <header>
                <StatusBadge status={a.decision} />
                <span className="muted small">{fmtTime(a.decidedAt)} 判定 · {fmtTime(a.archivedAt)} 失效留档</span>
              </header>
              <p className="small">
                回潮 {formatPct(a.regainPct)} · 偏差 {formatPct(a.deviationPct)} · 克重 {formatGsm(a.gsm)} · {a.ruleVersion}
              </p>
              <p className="small muted">{a.archiveReason}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConclusionBanner({ sheet }: { sheet: TestSheet }) {
  if (!sheet.conclusion) return null;
  const c = sheet.conclusion;
  const cls = c.decision === "released" ? "banner-released" : "banner-review";
  return (
    <div className={`banner ${cls}`}>
      <header>
        <h3>{c.decision === "released" ? `准予放行 · 克重 ${c.gsm} g/m²` : "只进待复核 · 不得放行克重"}</h3>
        <StatusBadge status={c.decision} />
      </header>
      <p className="small">
        回潮率 {c.regainPct}% · 两次称重偏差 {c.deviationPct}% · 天平校准{c.calibrationValid ? "有效" : "过期"} · {c.trigger} · {fmtTime(c.decidedAt)}
      </p>
      <ul className="reason-list">
        {c.reasons.map((r) => (
          <li key={r.code} className="small">{r.text}</li>
        ))}
      </ul>
      {sheet.reviewNote && <p className="small review-note">最新复核意见：{sheet.reviewNote}</p>}
    </div>
  );
}
