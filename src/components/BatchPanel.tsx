import { useState } from "react";
import { newClientToken } from "../data/useStation";
import { selectUnfinishedByBatch, stationStore } from "../data/station";
import type { StationState } from "../data/seed";
import { StatusBadge } from "./ui";

interface Props {
  state: StationState;
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  onNotify: (kind: "ok" | "err" | "dup", message: string) => void;
}

export function BatchPanel({ state, selectedSheetId, onSelectSheet, onNotify }: Props) {
  const [fabric, setFabric] = useState("");
  const [composition, setComposition] = useState("");
  const [nominalGsm, setNominalGsm] = useState("");
  const [orderNo, setOrderNo] = useState("");

  const addBatch = () => {
    const token = newClientToken();
    const res = stationStore.createBatch(token, {
      fabric,
      composition,
      nominalGsm: Number(nominalGsm),
      orderNo,
    });
    onNotify(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (res.ok && res.sheetId) {
      onSelectSheet(res.sheetId);
      setFabric("");
      setComposition("");
      setNominalGsm("");
      setOrderNo("");
    }
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>批次</p>
          <h2>面料批次</h2>
        </div>
        <span className="count-chip">{state.batches.length} 批</span>
      </div>

      <div className="batch-list">
        {state.batches.map((batch) => {
          const sheets = state.sheets.filter((s) => s.batchId === batch.id);
          const open = selectUnfinishedByBatch(state, batch.id);
          return (
            <article key={batch.id} className="batch-card">
              <header>
                <div>
                  <h3>{batch.fabric}</h3>
                  <p className="muted">{batch.id} · 订单 {batch.orderNo}</p>
                </div>
                <span className="gsm-chip">标称 {batch.nominalGsm} g/m²</span>
              </header>
              <p className="muted small">{batch.composition}</p>
              <ul className="sheet-links">
                {sheets.map((s) => (
                  <li key={s.id}>
                    <button
                      className={selectedSheetId === s.id ? "sheet-link active" : "sheet-link"}
                      onClick={() => onSelectSheet(s.id)}
                    >
                      <span>{s.id}</span>
                      <StatusBadge status={s.status} />
                    </button>
                  </li>
                ))}
                {sheets.length === 0 && <li className="muted small">暂无检测单</li>}
              </ul>
              <NewSheetForBatch batchId={batch.id} blockedBy={open?.id ?? null} onNotify={onNotify} onSelectSheet={onSelectSheet} />
            </article>
          );
        })}
      </div>

      <div className="sub-form">
        <h4>新建批次</h4>
        <label>
          <span>面料</span>
          <input value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="如 棉府绸" />
        </label>
        <label>
          <span>成分</span>
          <input value={composition} onChange={(e) => setComposition(e.target.value)} placeholder="如 100% 棉" />
        </label>
        <label>
          <span>标称克重 g/m²</span>
          <input value={nominalGsm} onChange={(e) => setNominalGsm(e.target.value)} inputMode="decimal" placeholder="如 120" />
        </label>
        <label>
          <span>客户订单号</span>
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="如 SO-88099" />
        </label>
        <button className="primary full" onClick={addBatch}>
          建批次并自动开检测单
        </button>
        <p className="muted small rule-hint">同一批只允许一张未结束检测单（检测中 / 待复核）</p>
      </div>
    </section>
  );
}

function NewSheetForBatch({
  batchId,
  blockedBy,
  onNotify,
  onSelectSheet,
}: {
  batchId: string;
  blockedBy: string | null;
  onNotify: Props["onNotify"];
  onSelectSheet: (id: string) => void;
}) {
  const add = () => {
    const res = stationStore.createSheet(newClientToken(), batchId, "TP-01");
    onNotify(res.ok ? (res.duplicate ? "dup" : "ok") : "err", res.message);
    if (res.ok && res.sheetId) onSelectSheet(res.sheetId);
  };
  if (blockedBy) {
    return <p className="muted small rule-hint">未结束单据 {blockedBy} 占用，禁止重复开单</p>;
  }
  return (
    <button className="ghost full" onClick={add}>
      为该批新开检测单
    </button>
  );
}
