// 页面层共享展示组件：状态徽标、原因标签、检测结论卡。
import type { Conclusion, SheetStatus } from "../domain/types";
import { REASON_LABELS } from "../domain/rules";

export const STATUS_CLASS: Record<SheetStatus, string> = {
  open: "badge badge-open",
  review: "badge badge-review",
  released: "badge badge-released",
};

const STATUS_LABEL: Record<SheetStatus, string> = {
  open: "检测中",
  review: "待复核",
  released: "已放行",
};

export function StatusBadge({ status }: { status: SheetStatus }) {
  return <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>;
}

export function ReasonTags({ reasons }: { reasons: Conclusion["reasons"] }) {
  if (reasons.length === 0) return <span className="tag tag-ok">全部规则通过</span>;
  return (
    <span className="reason-tags">
      {reasons.map((r) => (
        <span key={r} className="tag tag-bad" title={REASON_LABELS[r]}>
          {REASON_LABELS[r]}
        </span>
      ))}
    </span>
  );
}

export function fmtTime(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

export function ConclusionCard({ conclusion, archived = false }: { conclusion: Conclusion; archived?: boolean }) {
  return (
    <article className={archived ? "conclusion conclusion-archived" : "conclusion"}>
      <header>
        <span className={conclusion.decision === "released" ? "tag tag-ok" : "tag tag-bad"}>
          {conclusion.decision === "released" ? "放行克重" : "待复核（不得放行）"}
        </span>
        <small>
          规则 v{conclusion.ruleVersion} · {fmtTime(conclusion.decidedAt)} · {conclusion.decidedBy}
          {archived && conclusion.invalidatedBy ? (
            <em className="invalid-mark">
              {" "}
              · 已失效（{conclusion.invalidatedBy} · {fmtTime(conclusion.invalidatedAt)}）
            </em>
          ) : null}
        </small>
      </header>
      {conclusion.metrics ? (
        <dl className="metric-line">
          <div>
            <dt>两次偏差</dt>
            <dd>{conclusion.metrics.deviationPct}%</dd>
          </div>
          <div>
            <dt>实测回潮率</dt>
            <dd>{conclusion.metrics.regainPct}%</dd>
          </div>
          <div>
            <dt>干态克重</dt>
            <dd>{conclusion.metrics.dryGsm} g/m²</dd>
          </div>
          <div>
            <dt>修正克重</dt>
            <dd className="strong">{conclusion.metrics.correctedGsm} g/m²</dd>
          </div>
        </dl>
      ) : null}
      <ReasonTags reasons={conclusion.reasons} />
      {conclusion.override ? (
        <p className="override-note">复核强制放行说明：{conclusion.overrideNote}</p>
      ) : null}
    </article>
  );
}
