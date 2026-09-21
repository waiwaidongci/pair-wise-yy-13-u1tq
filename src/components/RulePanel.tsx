import { CORE_COMPLETE_LABELS, RULE_VERSION, WEIGH_DEVIATION_LIMIT_PCT } from "../rules/engine";

export function RulePanel() {
  return (
    <section className="panel rule-panel">
      <div className="heading">
        <div>
          <p>规则承载（与记录、页面分离）</p>
          <h2>放行判定规则</h2>
        </div>
        <span className="count-chip">{RULE_VERSION}</span>
      </div>
      <ol className="rule-list">
        <li>
          <b>一批一单。</b>同一面料批次同时只允许存在一张未结束检测单；检测中与待复核均视为未结束，已放行或已失效归档后才可另开新单。
        </li>
        <li>
          <b>资料齐全方可结束检测。</b>
          必须齐全的核心字段：{CORE_COMPLETE_LABELS.join("、")}；另需烘前湿重与试样面积用于回潮率与克重计算。缺项时检测单保持检测中，不得判定。
        </li>
        <li>
          <b>天平校准必须有效。</b>校准有效截止日期早于判定日期即视为过期；校准过期时只进待复核，不得放行克重。
        </li>
        <li>
          <b>两次称重偏差红线。</b>以第一次称重为基准，两次结果相对偏差 {`>`} {WEIGH_DEVIATION_LIMIT_PCT}% 时只进待复核，不得放行克重；{`≤`} {WEIGH_DEVIATION_LIMIT_PCT}% 时干重取两次均值。
        </li>
        <li>
          <b>计算公式。</b>回潮率 =（烘前湿重 − 干重均值）÷ 干重均值 × 100%；放行克重 = 干重均值 ÷ 试样面积（g/m²）。
        </li>
        <li>
          <b>更正即失效。</b>更正烘干记录或天平校准记录，原放行立即失效并按当前规则重算；校准更正会联动使用该天平的全部已结束单据，旧结论全部留档可查。
        </li>
        <li>
          <b>幂等提交。</b>重复或并发提交沿用首次结果，不重复计算、不改变首次结论。
        </li>
        <li>
          <b>刷新一致。</b>批次、复核队列与检测履历由同一记录存储驱动；刷新时按当前规则复核已生效结论，不一致即失效重算。
        </li>
      </ol>
    </section>
  );
}
