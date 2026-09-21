// 页面层：天平校准 —— 校准记录维护；更正即使相关已放行单失效重算。
import { useState } from "react";

import { isCalibrationValid } from "../domain/rules";
import { actions, today } from "../store/store";
import { useBalances, useStationState } from "../store/selectors";
import type { Notify } from "../appToast";

export function BalancePage({ notify }: { notify: Notify }) {
  const balances = useBalances();
  const state = useStationState();
  const [drafts, setDrafts] = useState<Record<string, { calibratedOn: string; validUntil: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const t = today();

  function draftOf(id: string, calibratedOn: string, validUntil: string) {
    return drafts[id] ?? { calibratedOn, validUntil };
  }

  function patch(id: string, base: { calibratedOn: string; validUntil: string }, key: keyof typeof base, v: string) {
    const d = draftOf(id, base.calibratedOn, base.validUntil);
    setDrafts((m) => ({ ...m, [id]: { ...d, [key]: v } }));
  }

  async function save(id: string, base: { calibratedOn: string; validUntil: string }) {
    const d = draftOf(id, base.calibratedOn, base.validUntil);
    const using = state.sheets.filter((s) => s.balanceId === id && s.current).length;
    if (using > 0) {
      const ok = window.confirm(
        `有 ${using} 张已评定检测单使用该天平。更正校准会使其原放行/结论立即失效并重算，旧结论留档。继续？`
      );
      if (!ok) return;
    }
    setBusyId(id);
    // 幂等键含新值：重复点击沿用首次结果
    const key = `calib:${id}:${d.calibratedOn}:${d.validUntil}`;
    try {
      const r = await actions.correctCalibration(id, d.calibratedOn, d.validUntil, key);
      notify(r.message, r.ok);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>天平校准</p>
            <h2>校准记录维护（今天 {t}）</h2>
          </div>
        </div>
        <p className="rule-note">
          规则：天平校准过期时提交评定<b>只进待复核、不得放行克重</b>。
          更正任一已被使用天平的校准记录，所有使用该天平的已评定检测单<b>原结论立即失效并按规则重算</b>，旧结论留档。
        </p>
        <div className="balance-list">
          {balances.map((b) => {
            const d = draftOf(b.id, b.calibratedOn, b.validUntil);
            const using = state.sheets.filter((s) => s.balanceId === b.id);
            const evaluated = using.filter((s) => s.current).length;
            const nowValid = isCalibrationValid({ validUntil: d.validUntil }, t);
            return (
              <article key={b.id} className="balance-card">
                <div className="balance-head">
                  <div>
                    <h3>
                      {b.id} · {b.name}{" "}
                      <span className={nowValid ? "tag tag-ok" : "tag tag-bad"}>
                        {nowValid ? "校准有效" : "校准过期"}
                      </span>
                    </h3>
                    <small className="muted">
                      使用中检测单 {using.length} 张（已评定 {evaluated} 张）
                    </small>
                  </div>
                </div>
                <div className="calib-fields">
                  <label>
                    <span>校准日期</span>
                    <input
                      type="date"
                      value={d.calibratedOn}
                      onChange={(e) => patch(b.id, { calibratedOn: b.calibratedOn, validUntil: b.validUntil }, "calibratedOn", e.target.value)}
                    />
                  </label>
                  <label>
                    <span>有效期至（当天有效）</span>
                    <input
                      type="date"
                      value={d.validUntil}
                      onChange={(e) => patch(b.id, { calibratedOn: b.calibratedOn, validUntil: b.validUntil }, "validUntil", e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busyId === b.id || (d.calibratedOn === b.calibratedOn && d.validUntil === b.validUntil)}
                    onClick={() => save(b.id, { calibratedOn: b.calibratedOn, validUntil: b.validUntil })}
                  >
                    {busyId === b.id ? "重算中…" : "更正校准并重算相关检测单"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
