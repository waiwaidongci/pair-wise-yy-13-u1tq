import { useMemo, useState } from "react";
import "./styles.css";
import { useStation } from "./data/useStation";
import { selectReviewQueue, stationStore } from "./data/station";
import { RULE_VERSION } from "./rules/engine";
import { BatchPanel } from "./components/BatchPanel";
import { SheetPanel } from "./components/SheetPanel";
import { ReviewQueue } from "./components/ReviewQueue";
import { BalancePanel } from "./components/BalancePanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { RulePanel } from "./components/RulePanel";
import { Notice } from "./components/ui";

type NotifyKind = "ok" | "err" | "dup";

function App() {
  const state = useStation();
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(state.sheets[0]?.id ?? null);
  const [toast, setToast] = useState<{ kind: NotifyKind; text: string } | null>(null);

  const sheet = state.sheets.find((s) => s.id === selectedSheetId) ?? null;
  const reviewQueue = useMemo(() => selectReviewQueue(state), [state]);

  const metrics = useMemo(() => {
    const released = state.sheets.filter((s) => s.status === "released");
    return [
      { label: "面料批次", value: state.batches.length },
      { label: "检测单（已结束/总数）", value: `${state.sheets.filter((s) => s.status !== "open").length}/${state.sheets.length}` },
      { label: "待复核队列", value: reviewQueue.length },
      { label: "已放行克重", value: released.length },
    ];
  }, [state, reviewQueue]);

  const notify = (kind: NotifyKind, text: string) => {
    setToast({ kind, text });
  };

  return (
    <main className="app">
      <section className="hero compact">
        <div className="hero-top">
          <p>hxyfront-62012 · 回潮检测与克重放行台 · 规则 {RULE_VERSION}</p>
          <button className="ghost" onClick={() => stationStore.resetDemo()}>重置演示数据</button>
        </div>
        <h1>染整小样 · 回潮检测与克重放行台</h1>
        <span>
          一批一单；烘干温度、时长、烘箱编号、两次称重齐全才可结束检测。天平校准过期或两次偏差超 0.5% 只进待复核，不得放行克重；
          更正烘干或校准记录后原放行立即失效并重算，旧结论留档。规则、记录、页面分层承载。
        </span>
      </section>

      {toast && (
        <div className="toast-wrap">
          <Notice kind={toast.kind}>{toast.text}</Notice>
          <button className="ghost" onClick={() => setToast(null)}>知道了</button>
        </div>
      )}

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace three-col">
        <BatchPanel
          state={state}
          selectedSheetId={selectedSheetId}
          onSelectSheet={setSelectedSheetId}
          onNotify={notify}
        />
        {sheet ? (
          <SheetPanel key={sheet.id} state={state} sheet={sheet} onNotify={notify} />
        ) : (
          <section className="panel">
            <p className="muted">请选择或新建一张检测单。</p>
          </section>
        )}
        <div className="right-col">
          <ReviewQueue
            state={state}
            selectedSheetId={selectedSheetId}
            onSelectSheet={setSelectedSheetId}
            onNotify={notify}
          />
          <BalancePanel state={state} onNotify={notify} />
        </div>
      </section>

      <HistoryPanel state={state} selectedSheetId={selectedSheetId} onSelectSheet={setSelectedSheetId} />
      <RulePanel />

      <footer className="muted small footer-note">
        规则引擎版本 {RULE_VERSION} · 记录持久化于浏览器 localStorage · 重复/并发提交沿用首次结果 · 刷新后批次、复核队列与检测履历保持一致
      </footer>
    </main>
  );
}

export default App;
