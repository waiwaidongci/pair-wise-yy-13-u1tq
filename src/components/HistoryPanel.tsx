import { useMemo, useState } from "react";
import type { StationState } from "../data/seed";
import { formatGsm, formatPct } from "../rules/engine";
import { fmtTime, StatusBadge } from "./ui";

interface Props {
  state: StationState;
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
}

export function HistoryPanel({ state, selectedSheetId, onSelectSheet }: Props) {
  const [batchFilter, setBatchFilter] = useState<string>("ALL");
  const [onlyActive, setOnlyActive] = useState(false);

  const rows = useMemo(() => {
    const list = state.history
      .filter((h) => (batchFilter === "ALL" ? true : h.batchId === batchFilter))
      .filter((h) => !onlyActive || h.active)
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    return list;
  }, [state.history, batchFilter, onlyActive]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>可追溯</p>
          <h2>检测履历</h2>
        </div>
        <div className="filters">
          <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="ALL">全部批次</option>
            {state.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.id} · {b.fabric}</option>
            ))}
          </select>
          <label className="inline-check">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            仅看当前生效结论
          </label>
        </div>
      </div>

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>检测单 / 批次</th>
              <th>触发</th>
              <th>结论</th>
              <th>回潮率</th>
              <th>两次偏差</th>
              <th>放行克重</th>
              <th>说明 / 留档</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr
                key={h.id}
                className={h.active ? "" : "stale-row"}
                onClick={() => onSelectSheet(h.sheetId)}
              >
                <td className="nowrap">{fmtTime(h.at)}</td>
                <td>
                  <button className="link-btn" onClick={() => onSelectSheet(h.sheetId)}>
                    {h.sheetId}
                  </button>
                  <span className="muted small"> / {h.batchId}</span>
                </td>
                <td>{h.trigger}</td>
                <td>
                  <StatusBadge status={h.decision} />
                  {!h.active && <span className="stale-tag">已失效留档</span>}
                </td>
                <td>{formatPct(h.regainPct)}</td>
                <td className={h.deviationPct !== null && h.deviationPct > 0.5 ? "text-bad" : ""}>{formatPct(h.deviationPct)}</td>
                <td>{formatGsm(h.gsm)}</td>
                <td className="note-cell">
                  {h.note ? <p className="small">{h.note}</p> : null}
                  {h.reasons.map((r) => (
                    <p key={r.code} className="small muted">{r.text}</p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        共 {rows.length} 条履历（含旧结论留档行）。刷新页面后批次、复核队列与本履历均从同一记录存储读取。
        {selectedSheetId ? ` 当前选中：${selectedSheetId}` : ""}
      </p>
    </section>
  );
}
