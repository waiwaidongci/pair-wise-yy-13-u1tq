// 页面层：批次台 —— 批次列表、按客户/订单筛选、开单入口。
import { useMemo, useState } from "react";

import type { Batch } from "../domain/types";
import { actions } from "../store/store";
import { useBalances, useBatches } from "../store/selectors";
import { StatusBadge } from "../components/common";
import type { Notify } from "../appToast";

export function BatchPage({
  onOpenSheet,
  notify,
}: {
  onOpenSheet: (sheetId: string) => void;
  notify: Notify;
}) {
  const rows = useBatches();
  const balances = useBalances();
  const [keyword, setKeyword] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<string>("");
  const [pendingBalance, setPendingBalance] = useState(
    balances.find((b) => b.valid)?.id ?? balances[0]?.id ?? ""
  );
  const [opening, setOpening] = useState(false);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(({ batch }) =>
      [batch.id, batch.customer, batch.orderNo, batch.fabric].join(" ").toLowerCase().includes(k)
    );
  }, [rows, keyword]);

  async function openSheet(batchId: string) {
    if (!pendingBalance) {
      notify("请先选择称重天平", false);
      return;
    }
    setOpening(true);
    setPendingBatch(batchId);
    try {
      // 开单键：同批+天平+短时间窗；后端式幂等由 store 兜底（一批一单 + 键去重）
      const key = `open:${batchId}:${Date.now().toString(36)}`;
      const r = await actions.openSheet(batchId, pendingBalance, key);
      notify(r.message, r.ok);
      if (r.ok && r.sheetId) onOpenSheet(r.sheetId);
    } finally {
      setOpening(false);
      setPendingBatch("");
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>批次台</p>
            <h2>小样批次与检测单</h2>
          </div>
          <div className="toolbar">
            <input
              className="search"
              placeholder="按批号 / 客户 / 订单号 / 品种筛选"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button className="primary" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "收起" : "登记新批次"}
            </button>
          </div>
        </div>

        <div className="open-bar">
          <label className="inline">
            <span>新开单使用天平：</span>
            <select value={pendingBalance} onChange={(e) => setPendingBalance(e.target.value)}>
              {balances.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {b.name}
                  {b.valid ? "（校准有效）" : "（校准过期：只进复核）"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="batch-list">
          {filtered.map(({ batch, openSheet: os, latestSheet, sheets }) => (
            <article key={batch.id} className="batch-card">
              <div className="batch-main">
                <div className="batch-id">
                  <h3>{batch.id}</h3>
                  {os || latestSheet ? <StatusBadge status={(os ?? latestSheet)!.status} /> : null}
                  {!os && !latestSheet && <span className="tag">未开单</span>}
                </div>
                <p className="batch-meta">
                  {batch.customer} · 订单 {batch.orderNo} · {batch.fabric}
                </p>
                <p className="batch-spec">
                  公称回潮 {batch.nominalRegainPct}% · 目标克重 {batch.targetGsm}±
                  {batch.gsmTolerancePct}% g/m² · 取样 {batch.sampleAreaDm2 / 100} m²
                </p>
              </div>
              <div className="batch-actions">
                {os ? (
                  <>
                    <button className="primary" onClick={() => onOpenSheet(os.id)}>
                      继续检测单 {os.id.slice(-6)}
                    </button>
                    <small>该批存在未结束检测单，不能重复开单</small>
                  </>
                ) : (
                  <button
                    disabled={opening && pendingBatch === batch.id}
                    onClick={() => openSheet(batch.id)}
                  >
                    {opening && pendingBatch === batch.id ? "提交中…" : "开具检测单"}
                  </button>
                )}
                {sheets.length > 1 ? <small>历史检测单 {sheets.length} 张</small> : null}
              </div>
            </article>
          ))}
          {filtered.length === 0 && <p className="empty">没有匹配的批次</p>}
        </div>
      </section>

      {showAdd ? <AddBatchForm notify={notify} onDone={() => setShowAdd(false)} /> : null}
    </div>
  );
}

function AddBatchForm({ notify, onDone }: { notify: Notify; onDone: () => void }) {
  const [form, setForm] = useState({
    id: "",
    customer: "",
    orderNo: "",
    fabric: "",
    nominalRegainPct: "8.5",
    targetGsm: "",
    gsmTolerancePct: "3",
    sampleAreaDm2: "1",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.id.trim() || !form.customer.trim() || !form.orderNo.trim() || !form.fabric.trim()) {
      notify("批号、客户、订单号、品种均必填", false);
      return;
    }
    const payload: Omit<Batch, "createdAt"> = {
      id: form.id.trim(),
      customer: form.customer.trim(),
      orderNo: form.orderNo.trim(),
      fabric: form.fabric.trim(),
      nominalRegainPct: Number(form.nominalRegainPct),
      targetGsm: Number(form.targetGsm),
      gsmTolerancePct: Number(form.gsmTolerancePct),
      sampleAreaDm2: Number(form.sampleAreaDm2),
    };
    if (
      ![payload.nominalRegainPct, payload.targetGsm, payload.gsmTolerancePct, payload.sampleAreaDm2].every(
        (n) => Number.isFinite(n) && n > 0
      )
    ) {
      notify("回潮率/目标克重/公差/取样面积必须为正数", false);
      return;
    }
    const r = await actions.addBatch(payload);
    notify(r.message, r.ok);
    if (r.ok) onDone();
  }

  return (
    <section className="panel">
      <h2>登记新批次</h2>
      <div className="field-grid">
        <label>
          <span>批号 *</span>
          <input value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="PC260921-xx" />
        </label>
        <label>
          <span>客户 *</span>
          <input value={form.customer} onChange={(e) => set("customer", e.target.value)} />
        </label>
        <label>
          <span>客户订单号 *</span>
          <input value={form.orderNo} onChange={(e) => set("orderNo", e.target.value)} placeholder="SO-xxxxx" />
        </label>
        <label>
          <span>面料/品种 *</span>
          <input value={form.fabric} onChange={(e) => set("fabric", e.target.value)} />
        </label>
        <label>
          <span>公称回潮率 %</span>
          <input type="number" step="0.1" value={form.nominalRegainPct} onChange={(e) => set("nominalRegainPct", e.target.value)} />
        </label>
        <label>
          <span>目标克重 g/m² *</span>
          <input type="number" value={form.targetGsm} onChange={(e) => set("targetGsm", e.target.value)} />
        </label>
        <label>
          <span>放行公差 %</span>
          <input type="number" step="0.5" value={form.gsmTolerancePct} onChange={(e) => set("gsmTolerancePct", e.target.value)} />
        </label>
        <label>
          <span>取样面积 dm²</span>
          <input type="number" step="0.1" value={form.sampleAreaDm2} onChange={(e) => set("sampleAreaDm2", e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary" onClick={submit}>
          保存批次
        </button>
      </div>
    </section>
  );
}
