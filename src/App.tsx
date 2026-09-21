import { useCallback, useState } from "react";

import "./styles.css";
import { actions, useStation } from "./store/store";
import { useMetrics, useReviewQueue } from "./store/selectors";
import { RulesPage } from "./pages/RulesPage";
import { BatchPage } from "./pages/BatchPage";
import { InspectionPage } from "./pages/InspectionPage";
import { ReviewPage } from "./pages/ReviewPage";
import { HistoryPage } from "./pages/HistoryPage";
import { BalancePage } from "./pages/BalancePage";
import type { Notify } from "./appToast";

type Tab = "rules" | "batches" | "inspection" | "review" | "history" | "balances";

const TABS: { key: Tab; label: string }[] = [
  { key: "rules", label: "放行规则" },
  { key: "batches", label: "批次台" },
  { key: "inspection", label: "检测台" },
  { key: "review", label: "复核队列" },
  { key: "history", label: "检测履历" },
  { key: "balances", label: "天平校准" },
];

function App() {
  const [tab, setTab] = useState<Tab>("batches");
  const [inspectSheetId, setInspectSheetId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean; n: number } | null>(null);
  const [operatorDraft, setOperatorDraft] = useState("");
  const metrics = useMetrics();
  const queue = useReviewQueue();
  const currentOperator = useStation((s) => s.operator);

  const notify = useCallback<Notify>((message, ok) => {
    setToast({ msg: message, ok, n: Date.now() });
  }, []);

  function goInspect(sheetId: string) {
    setInspectSheetId(sheetId);
    setTab("inspection");
  }

  async function resetDemo() {
    if (!window.confirm("确定清空当前全部记录并恢复演示数据？")) return;
    const r = await actions.resetDemo();
    notify(r.message, r.ok);
  }

  return (
    <main className="app">
      <section className="hero compact">
        <div className="hero-top">
          <div>
            <p>hxyfront-62012 · 染整实验室 · Port 62012</p>
            <h1>回潮检测与克重放行台</h1>
            <span>
              同一批一张未结束检测单；温度、时长、烘箱编号与两次称重齐全方可评定；天平校准过期或两次偏差超
              0.5% 只进待复核，不得放行克重。更正烘干或校准记录，原放行立即失效重算，旧结论留档。
            </span>
          </div>
          <div className="operator-box">
            <span className="operator-current">
              当前操作人：<b>{currentOperator}</b>
            </span>
            <label className="inline">
              <span>切换</span>
              <input
                placeholder="输入姓名后登记"
                value={operatorDraft}
                onChange={(e) => setOperatorDraft(e.target.value)}
              />
            </label>
            <button
              onClick={async () => {
                if (!operatorDraft.trim()) return;
                const r = await actions.setOperator(operatorDraft);
                notify(r.message, r.ok);
                setOperatorDraft("");
              }}
            >
              登记
            </button>
            <button className="ghost" onClick={resetDemo}>
              重置演示数据
            </button>
          </div>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>批次</small>
          <strong>{metrics.batches}</strong>
        </article>
        <article>
          <small>检测中</small>
          <strong>{metrics.open}</strong>
        </article>
        <article className={queue.length ? "metric-alert" : ""}>
          <small>待复核（不得放行）</small>
          <strong>{metrics.review}</strong>
        </article>
        <article>
          <small>已放行</small>
          <strong>{metrics.released}</strong>
        </article>
        <article>
          <small>失效留档旧结论</small>
          <strong>{metrics.invalidated}</strong>
        </article>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab on" : "tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "review" && queue.length > 0 ? <i className="tab-dot">{queue.length}</i> : null}
          </button>
        ))}
      </nav>

      {tab === "rules" && <RulesPage />}
      {tab === "batches" && <BatchPage onOpenSheet={goInspect} notify={notify} />}
      {tab === "inspection" && <InspectionPage initialSheetId={inspectSheetId} notify={notify} />}
      {tab === "review" && <ReviewPage notify={notify} />}
      {tab === "history" && <HistoryPage />}
      {tab === "balances" && <BalancePage notify={notify} />}

      {toast ? (
        <div key={toast.n} className={toast.ok ? "toast ok" : "toast bad"} role="status">
          {toast.msg}
        </div>
      ) : null}
    </main>
  );
}

export default App;
