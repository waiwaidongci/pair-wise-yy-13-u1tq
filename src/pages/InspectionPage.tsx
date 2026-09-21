// 页面层：检测台 —— 检测单录入、提交评定、放行后更正烘干（失效重算留档）。
import { useEffect, useMemo, useState } from "react";

import type { DryingRecord } from "../domain/types";
import { actions } from "../store/store";
import { useBalances, useStationState } from "../store/selectors";
import { ConclusionCard, fmtTime, StatusBadge } from "../components/common";
import { DryingForm, type DryingFormValue } from "../components/DryingForm";
import type { Notify } from "../appToast";

function emptyForm(balanceId: string): DryingFormValue {
  return {
    balanceId,
    drying: {
      ovenNo: "",
      tempC: null,
      durationMin: null,
      wetWeightG: null,
      dryWeight1G: null,
      dryWeight2G: null,
    },
  };
}

export function InspectionPage({
  initialSheetId,
  notify,
}: {
  initialSheetId?: string | null;
  notify: Notify;
}) {
  const state = useStationState();
  const balances = useBalances();
  const [selectedId, setSelectedId] = useState<string | null>(initialSheetId ?? null);
  const [filter, setFilter] = useState<"unfinished" | "released" | "all">("unfinished");
  const [form, setForm] = useState<DryingFormValue | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doubleSubmit, setDoubleSubmit] = useState(false);

  const sheetList = useMemo(() => {
    const list = state.sheets.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (filter === "unfinished") return list.filter((x) => x.status === "open" || x.status === "review");
    if (filter === "released") return list.filter((x) => x.status === "released");
    return list;
  }, [state.sheets, filter]);

  const sheet = state.sheets.find((x) => x.id === selectedId) ?? null;
  const batch = sheet ? state.batches.find((b) => b.id === sheet.batchId) ?? null : null;

  // 选中检测单时，把记录载入表单（更正前的编辑缓冲，不直接改记录）
  useEffect(() => {
    if (sheet) {
      setForm({ balanceId: sheet.balanceId, drying: JSON.parse(JSON.stringify(sheet.drying)) as DryingRecord });
      setCorrecting(false);
    } else {
      setForm(null);
    }
  }, [sheet?.id, sheet?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialSheetId) setSelectedId(initialSheetId);
  }, [initialSheetId]);

  const formDisabled = !sheet || !form || (sheet.status === "released" && !correcting);

  async function saveDraft() {
    if (!sheet || !form) return;
    setBusy(true);
    try {
      const r = await actions.saveDraft(sheet.id, form.balanceId, form.drying);
      notify(r.message, r.ok);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!sheet || !form || !batch) return;
    setBusy(true);
    // 幂等键绑定本次表单内容；双击/并发的第二次沿用首次结果
    const key = `submit:${sheet.id}:${JSON.stringify(form.drying)}:${form.balanceId}`;
    try {
      const r = await actions.submit(sheet.id, form.balanceId, form.drying, key);
      notify(r.message, r.ok);
    } finally {
      setBusy(false);
      setDoubleSubmit(false);
    }
  }

  async function submitCorrection() {
    if (!sheet || !form) return;
    setBusy(true);
    const key = `correct-drying:${sheet.id}:${JSON.stringify(form.drying)}`;
    try {
      const r = await actions.correctDrying(sheet.id, form.drying, key);
      notify(r.message, r.ok);
    } finally {
      setBusy(false);
    }
  }

  function simulateDouble() {
    setDoubleSubmit(true);
    submit();
    // 立即再点一次：同一幂等键，第二次沿用首次结果
    setTimeout(() => {
      setBusy(false);
      actions
        .submit(sheet!.id, form!.balanceId, form!.drying, `submit:${sheet!.id}:${JSON.stringify(form!.drying)}:${form!.balanceId}`)
        .then((r) => notify("并发第二次提交 → " + r.message, true));
    }, 120);
  }

  return (
    <div className="inspection-layout">
      <aside className="panel sheet-list">
        <div className="heading">
          <div>
            <p>检测台</p>
            <h2>检测单</h2>
          </div>
        </div>
        <div className="seg">
          <button className={filter === "unfinished" ? "on" : ""} onClick={() => setFilter("unfinished")}>
            未结束
          </button>
          <button className={filter === "released" ? "on" : ""} onClick={() => setFilter("released")}>
            已放行
          </button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            全部
          </button>
        </div>
        {sheetList.map((x) => {
          const b = state.batches.find((bb) => bb.id === x.batchId);
          return (
            <button
              key={x.id}
              className={"sheet-item" + (selectedId === x.id ? " selected" : "")}
              onClick={() => setSelectedId(x.id)}
            >
              <span className="sheet-item-id">{x.id}</span>
              <span className="sheet-item-batch">{b?.id}</span>
              <StatusBadge status={x.status} />
            </button>
          );
        })}
        {sheetList.length === 0 && <p className="empty">该分类下暂无检测单</p>}
      </aside>

      <section className="panel sheet-detail">
        {!sheet || !batch || !form ? (
          <p className="empty">请从左侧选择检测单，或先到批次台开具检测单</p>
        ) : (
          <>
            <div className="heading">
              <div>
                <p>{batch.id} · {batch.customer} · {batch.fabric}</p>
                <h2>
                  {sheet.id} <StatusBadge status={sheet.status} />
                  <small className="seq">第 {sheet.seq} 版结论</small>
                </h2>
              </div>
              <div>
                <small className="muted">
                  开单 {fmtTime(sheet.createdAt)} · {sheet.createdBy}
                </small>
              </div>
            </div>

            {sheet.status === "released" && !correcting ? (
              <div className="correction-bar">
                <span>该单已放行克重。更正烘干/称重会使<b>原放行立即失效并重算</b>，旧结论留档。</span>
                <button onClick={() => setCorrecting(true)}>更正烘干记录</button>
              </div>
            ) : null}
            {sheet.status === "released" && correcting ? (
              <div className="correction-bar active">
                <span>更正模式：天平沿用原单（{sheet.balanceId}）；如天平校准有变，请到「天平校准」页统一更正重算。</span>
                <button onClick={() => setCorrecting(false)}>取消更正</button>
              </div>
            ) : null}
            {sheet.status === "review" ? (
              <div className="correction-bar review">
                <span>当前为待复核：可补正数据后重新提交规则评定，或等待复核台裁定；复核队列与本页实时一致。</span>
              </div>
            ) : null}

            <DryingForm
              value={form}
              balances={balances}
              batch={batch}
              onChange={setForm}
              disabled={formDisabled}
              lockBalance={sheet.status === "released"}
            />

            <div className="form-actions">
              {sheet.status !== "released" || correcting ? (
                <>
                  {sheet.status !== "released" && (
                    <button disabled={busy} onClick={saveDraft}>
                      暂存草稿
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={busy || doubleSubmit}
                    onClick={sheet.status === "released" ? submitCorrection : submit}
                  >
                    {busy ? "提交中…" : sheet.status === "released" ? "提交更正并重算（旧结论留档）" : "提交评定"}
                  </button>
                  {sheet.status !== "released" && (
                    <button className="ghost" disabled={busy} onClick={simulateDouble} title="模拟双击/并发：验证幂等键">
                      模拟重复并发提交
                    </button>
                  )}
                </>
              ) : (
                <span className="hint-ok">克重已放行；如需改动请使用上方“更正烘干记录”。</span>
              )}
            </div>

            <div className="conclusions">
              <h3>当前结论</h3>
              {sheet.current ? (
                <ConclusionCard conclusion={sheet.current} />
              ) : (
                <p className="empty">尚无评定结论（检测中，要素未提交）</p>
              )}
              {sheet.archivedConclusions.length > 0 && (
                <>
                  <h3>旧结论留档（{sheet.archivedConclusions.length}）</h3>
                  {sheet.archivedConclusions
                    .slice()
                    .reverse()
                    .map((c, i) => (
                      <ConclusionCard key={i} conclusion={c} archived />
                    ))}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
