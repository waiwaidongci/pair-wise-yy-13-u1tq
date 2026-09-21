import { useState } from "react";
import { newClientToken } from "../data/useStation";
import { selectReviewQueue, stationStore } from "../data/station";
import type { StationState } from "../data/seed";
import { formatGsm, formatPct } from "../rules/engine";
import { fmtTime, StatusBadge } from "./ui";

interface Props {
  state: StationState;
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  onNotify: (kind: "ok" | "err" | "dup", message: string) => void;
}

export function ReviewQueue({ state, selectedSheetId, onSelectSheet, onNotify }: Props) {
  const queue = selectReviewQueue(state);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const saveNote = (sheetId: string) => {
    const res = stationStore.addReviewNote(newClientToken(), sheetId, note);
    onNotify(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (res.ok) {
      setNote("");
      setNoteFor(null);
    }
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>质检复核</p>
          <h2>待复核队列</h2>
        </div>
        <span className="count-chip review-count">{queue.length} 单</span>
      </div>
      {queue.length === 0 && <p className="muted">队列已清空，没有待复核单据。</p>}
      <div className="queue-list">
        {queue.map((s) => {
          const batch = state.batches.find((b) => b.id === s.batchId);
          const balance = state.balances.find((b) => b.id === s.balanceId);
          return (
            <article key={s.id} className={selectedSheetId === s.id ? "queue-card active" : "queue-card"}>
              <button className="queue-head" onClick={() => onSelectSheet(s.id)}>
                <div>
                  <h3>{s.id}</h3>
                  <p className="muted small">{batch?.fabric} · {batch?.id} · {balance?.id}</p>
                </div>
                <StatusBadge status={s.status} />
              </button>
              <p className="small">
                回潮 {formatPct(s.conclusion?.regainPct ?? null)} · 偏差 {formatPct(s.conclusion?.deviationPct ?? null)} · 克重 {formatGsm(s.conclusion?.gsm ?? null)}
              </p>
              <ul className="reason-list">
                {s.conclusion?.reasons.map((r) => (
                  <li key={r.code} className="small text-bad">{r.text}</li>
                ))}
              </ul>
              {s.reviewNote && <p className="small review-note">复核意见：{s.reviewNote}（{fmtTime(s.decidedAt)}）</p>}
              {noteFor === s.id ? (
                <div className="note-box">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="填写复核意见（须通过更正校准/烘干记录重算后才能放行）" rows={3} />
                  <div className="row-btns">
                    <button className="primary" onClick={() => saveNote(s.id)}>保存意见</button>
                    <button className="ghost" onClick={() => { setNoteFor(null); setNote(""); }}>取消</button>
                  </div>
                </div>
              ) : (
                <button className="ghost full" onClick={() => { setNoteFor(s.id); setNote(s.reviewNote ?? ""); }}>
                  登记复核意见
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
