// 页面层：复核队列 —— 待复核单的人工裁定（放行留痕 / 退回检测）。
import { useState } from "react";

import { isCalibrationValid } from "../domain/rules";
import { actions, today } from "../store/store";
import { useBalances, useReviewQueue, useStationState } from "../store/selectors";
import { ConclusionCard, fmtTime } from "../components/common";
import type { Notify } from "../appToast";

const ACTION_LABEL: Record<string, string> = {
  OPEN_SHEET: "开具检测单",
  SAVE_DRAFT: "暂存草稿",
  SUBMIT: "提交评定/更正",
  OVERRIDE_RELEASE: "复核裁定放行",
  RETURN: "复核退回",
  CORRECT_CALIBRATION: "更正校准",
  ADD_BATCH: "登记批次",
  RESET_DEMO: "重置演示",
};

export function ReviewPage({ notify }: { notify: Notify }) {
  const queue = useReviewQueue();
  const state = useStationState();
  const balances = useBalances();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const setNote = (id: string, v: string) => setNotes((m) => ({ ...m, [id]: v }));

  async function decide(sheetId: string, action: "release" | "return") {
    const note = (notes[sheetId] ?? "").trim();
    if (!note) {
      notify(action === "release" ? "裁定放行必须填写复核说明" : "退回必须填写原因", false);
      return;
    }
    setBusyId(sheetId + action);
    // 幂等键包含裁定动作与说明：同一操作重复点击沿用首次结果
    const key = `${action}:${sheetId}:${note}`;
    try {
      const r =
        action === "release"
          ? await actions.overrideRelease(sheetId, note, key)
          : await actions.returnSheet(sheetId, note, key);
      notify(r.message, r.ok);
      if (r.ok) setNotes((m) => ({ ...m, [sheetId]: "" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>复核队列</p>
            <h2>待复核检测单（{queue.length}）</h2>
          </div>
        </div>
        {queue.length === 0 && <p className="empty">复核队列为空，所有已评定批次均已放行。</p>}
        <div className="review-list">
          {queue.map((sheet) => {
            const batch = state.batches.find((b) => b.id === sheet.batchId);
            const balance = balances.find((x) => x.id === sheet.balanceId);
            const calibOk = balance ? isCalibrationValid(balance, today()) : false;
            return (
              <article key={sheet.id} className="review-card">
                <div className="review-head">
                  <div>
                    <h3>
                      {sheet.id} <span className="muted">/ {batch?.id} · {batch?.customer} · {batch?.fabric}</span>
                    </h3>
                    <small className="muted">
                      烘箱 {sheet.drying.ovenNo} · {sheet.drying.tempC}℃ · {sheet.drying.durationMin}min ·
                      初重 {sheet.drying.wetWeightG}g · 称重 {sheet.drying.dryWeight1G} / {sheet.drying.dryWeight2G}g ·
                      天平 {sheet.balanceId}
                      <span className={calibOk ? "hint-ok" : "hint-bad"}>
                        {calibOk ? "（校准有效）" : "（校准过期）"}
                      </span>
                    </small>
                  </div>
                  <small className="muted">提交于 {fmtTime(sheet.current?.decidedAt)}</small>
                </div>

                {sheet.current && <ConclusionCard conclusion={sheet.current} />}
                {sheet.archivedConclusions.length > 0 && (
                  <details>
                    <summary>旧结论留档（{sheet.archivedConclusions.length}）</summary>
                    {sheet.archivedConclusions
                      .slice()
                      .reverse()
                      .map((c, i) => (
                        <ConclusionCard key={i} conclusion={c} archived />
                      ))}
                  </details>
                )}

                <label className="review-note">
                  <span>复核说明 / 退回原因 *</span>
                  <textarea
                    rows={2}
                    value={notes[sheet.id] ?? ""}
                    placeholder="如：核对天平校准证书后批准放行；或：烘箱温度存疑，退回 105℃ 重做"
                    onChange={(e) => setNote(sheet.id, e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="danger"
                    disabled={busyId !== null}
                    onClick={() => decide(sheet.id, "return")}
                  >
                    {busyId === sheet.id + "return" ? "提交中…" : "退回检测"}
                  </button>
                  <button
                    className="primary"
                    disabled={busyId !== null}
                    onClick={() => decide(sheet.id, "release")}
                  >
                    {busyId === sheet.id + "release" ? "提交中…" : "裁定放行（留痕）"}
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

export { ACTION_LABEL };
