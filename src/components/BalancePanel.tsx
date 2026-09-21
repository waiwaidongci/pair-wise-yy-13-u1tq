import { useState } from "react";
import { newClientToken } from "../data/useStation";
import { stationStore } from "../data/station";
import type { StationState } from "../data/seed";
import { isCalibrationValid, todayString } from "../rules/engine";
import type { Balance } from "../rules/types";
import { fmtTime } from "./ui";

interface Props {
  state: StationState;
  onNotify: (kind: "ok" | "err" | "dup", message: string) => void;
}

export function BalancePanel({ state, onNotify }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calibratedOn, setCalibratedOn] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [officer, setOfficer] = useState("");

  const startEdit = (b: Balance) => {
    setEditingId(b.id);
    setCalibratedOn(b.calibratedOn);
    setValidUntil(b.validUntil);
    setOfficer(b.officer);
  };

  const save = (balanceId: string) => {
    const res = stationStore.correctCalibration(newClientToken(), balanceId, {
      calibratedOn,
      validUntil,
      officer,
    });
    onNotify(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (res.ok) setEditingId(null);
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>计量器具</p>
          <h2>天平校准档案</h2>
        </div>
        <span className="muted small">今天 {todayString()}</span>
      </div>
      <div className="balance-list">
        {state.balances.map((b) => {
          const valid = isCalibrationValid(b);
          const affected = state.sheets.filter((s) => s.balanceId === b.id && s.status !== "open");
          const editing = editingId === b.id;
          return (
            <article key={b.id} className={valid ? "balance-card" : "balance-card bad"}>
              <header>
                <div>
                  <h3>{b.id} · {b.name}</h3>
                  <p className={valid ? "cal-state ok" : "cal-state bad"}>{valid ? "校准有效" : "校准已过期"}</p>
                </div>
                {!editing && (
                  <button className="ghost" onClick={() => startEdit(b)}>更正当次校准</button>
                )}
              </header>

              {!editing ? (
                <>
                  <p className="small">校准 {b.calibratedOn} ～ 有效至 {b.validUntil} · 校准人 {b.officer}</p>
                  {affected.length > 0 && (
                    <p className="small muted">
                      更正后将联动重算 {affected.length} 张已结束单据（{affected.map((s) => s.id).join("、")}），原放行立即失效、旧结论留档
                    </p>
                  )}
                </>
              ) : (
                <div className="cal-edit">
                  <label>
                    <span>校准日期</span>
                    <input type="date" value={calibratedOn} onChange={(e) => setCalibratedOn(e.target.value)} />
                  </label>
                  <label>
                    <span>有效截止日期</span>
                    <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </label>
                  <label>
                    <span>校准人</span>
                    <input value={officer} onChange={(e) => setOfficer(e.target.value)} />
                  </label>
                  <div className="row-btns">
                    <button className="primary" onClick={() => save(b.id)}>保存并联动重算</button>
                    <button className="ghost" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              )}

              {b.history.length > 0 && (
                <details className="cal-history">
                  <summary>旧校准记录留档（{b.history.length}）</summary>
                  <ul>
                    {b.history.map((h, i) => (
                      <li key={i} className="small muted">
                        {h.calibratedOn} ～ {h.validUntil} · {h.officer} · {fmtTime(h.correctedAt)} 被更正
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
