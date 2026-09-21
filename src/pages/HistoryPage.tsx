// 页面层：检测履历 —— 全量检测单版本时间线 + 操作审计流（旧结论留档可追溯）。
import { useMemo, useState } from "react";

import { useStationState } from "../store/selectors";
import { ConclusionCard, fmtTime, StatusBadge } from "../components/common";

const ACTION_LABEL: Record<string, string> = {
  OPEN_SHEET: "开具检测单",
  SAVE_DRAFT: "暂存草稿",
  SUBMIT: "提交评定 / 更正重算",
  OVERRIDE_RELEASE: "复核裁定放行",
  RETURN: "复核退回检测",
  CORRECT_CALIBRATION: "更正天平校准",
  ADD_BATCH: "登记批次",
  RESET_DEMO: "重置演示数据",
};

const INVALID_LABEL: Record<string, string> = {
  DRYING: "烘干记录更正",
  CALIBRATION: "校准记录更正",
  RETURN: "复核退回",
  REEVALUATE: "重新评定",
};

export function HistoryPage() {
  const state = useStationState();
  const [tab, setTab] = useState<"sheets" | "audit">("sheets");
  const [keyword, setKeyword] = useState("");

  const sheets = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const list = state.sheets.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!k) return list;
    return list.filter((s) => {
      const b = state.batches.find((x) => x.id === s.batchId);
      return [s.id, s.batchId, b?.customer ?? "", b?.orderNo ?? "", b?.fabric ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(k);
    });
  }, [state, keyword]);

  const audits = useMemo(() => state.audits, [state]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>检测履历</p>
          <h2>版本时间线与操作留痕</h2>
        </div>
        <div className="toolbar">
          <input
            className="search"
            placeholder="按检测单号 / 批号 / 客户检索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="seg">
            <button className={tab === "sheets" ? "on" : ""} onClick={() => setTab("sheets")}>
              检测单履历
            </button>
            <button className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>
              操作审计流
            </button>
          </div>
        </div>
      </div>

      {tab === "sheets" ? (
        <div className="history-list">
          {sheets.map((sheet) => {
            const batch = state.batches.find((b) => b.id === sheet.batchId);
            const total = 1 + sheet.archivedConclusions.length;
            return (
              <article key={sheet.id} className="history-card">
                <header className="history-head">
                  <div>
                    <h3>
                      {sheet.id} <StatusBadge status={sheet.status} />
                    </h3>
                    <p className="muted">
                      {batch?.id} · {batch?.customer} · 订单 {batch?.orderNo} · {batch?.fabric} ·
                      天平 {sheet.balanceId} · 共 {total} 版结论
                    </p>
                  </div>
                  <small className="muted">开单 {fmtTime(sheet.createdAt)} · {sheet.createdBy}</small>
                </header>

                <ol className="timeline">
                  {sheet.archivedConclusions.map((c, i) => (
                    <li key={`a-${i}`} className="tl-item tl-old">
                      <div className="tl-tag">
                        v{i + 1} · 已失效
                        {c.invalidatedBy ? `（${INVALID_LABEL[c.invalidatedBy] ?? c.invalidatedBy}）` : ""}
                      </div>
                      <ConclusionCard conclusion={c} archived />
                    </li>
                  ))}
                  {sheet.current ? (
                    <li className="tl-item tl-current">
                      <div className="tl-tag">v{sheet.seq || total} · 当前生效</div>
                      <ConclusionCard conclusion={sheet.current} />
                    </li>
                  ) : (
                    <li className="tl-item">
                      <div className="tl-tag">检测中 · 暂无结论（要素未齐，已存草稿）</div>
                    </li>
                  )}
                </ol>
              </article>
            );
          })}
          {sheets.length === 0 && <p className="empty">没有匹配的检测单</p>}
        </div>
      ) : (
        <div className="audit-list">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 170 }}>时间</th>
                <th style={{ width: 110 }}>操作人</th>
                <th style={{ width: 150 }}>动作</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>{fmtTime(a.at)}</td>
                  <td>{a.operator}</td>
                  <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td>
                    {a.detail}
                    {a.sheetId ? <em className="muted"> 〔{a.sheetId}〕</em> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
