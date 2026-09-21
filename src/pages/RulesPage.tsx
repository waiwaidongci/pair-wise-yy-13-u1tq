// 页面层：放行规则（规则在此单独承载，记录与页面不内联判定常量）。
import {
  DEFAULT_GSM_TOLERANCE_PCT,
  DEVIATION_LIMIT_PCT,
  REASON_LABELS,
  REQUIRED_DRYING_FIELDS,
  RULE_VERSION,
} from "../domain/rules";
import { useBalances } from "../store/selectors";

export function RulesPage() {
  const balances = useBalances();
  return (
    <div className="page-grid">
      <section className="panel">
        <h2>放行规则（规则版本 v{RULE_VERSION}）</h2>
        <ol className="rule-list">
          <li>
            <b>一批一单</b>：同一批只允许存在<b>一张未结束检测单</b>（检测中 / 待复核）；重复开单沿用首张，
            已放行后再开视为该批新一轮检测。
          </li>
          <li>
            <b>要素齐全才可提交</b>：{REQUIRED_DRYING_FIELDS.map((f) => f.label).join("、")}
            ，六项缺一不得提交评定。
          </li>
          <li>
            <b>只进待复核、不得放行克重</b>：天平校准过期，或两次称重相对偏差{" "}
            <b>|d₁−d₂| / 均值 &gt; {DEVIATION_LIMIT_PCT}%</b>。
          </li>
          <li>
            <b>克重放行区间</b>：以公称回潮率把干态克重修正到约定回潮后，须落在 目标克重 ±
            {DEFAULT_GSM_TOLERANCE_PCT}%（批次可单独配置）内；越界同样转复核裁定。
          </li>
          <li>
            <b>更正即失效重算</b>：更正已放行单的烘干/称重记录，或更正天平校准记录，
            原放行<b>立即失效并按规则重算</b>，旧结论原样留档（含失效原因与时间）。
          </li>
          <li>
            <b>复核裁定留痕</b>：待复核单只能由复核台「裁定放行（填写说明）」或「退回检测」；
            强制放行记录操作人与说明。
          </li>
          <li>
            <b>幂等</b>：重复或并发提交沿用首次结果（同一提交键只执行一次）；
            数据持久保存，刷新后批次、复核队列与检测履历一致。
          </li>
        </ol>
      </section>

      <section className="panel">
        <h2>计算口径</h2>
        <ul className="rule-list plain">
          <li>实测回潮率 =（烘前初重 − 两次干重均值）÷ 两次干重均值 × 100%</li>
          <li>干态克重 = 两次干重均值 ÷ 取样面积（m²）</li>
          <li>修正克重 = 干态克重 ×（1 + 公称回潮率 ÷ 100）</li>
          <li>称重偏差 = |第一次 − 第二次| ÷ 两次均值 × 100%（限 {DEVIATION_LIMIT_PCT}%）</li>
          <li>校准有效期当天仍有效，次日起判定过期</li>
        </ul>
        <h3>复核触发原因编码</h3>
        <ul className="rule-list plain">
          {Object.entries(REASON_LABELS).map(([code, label]) => (
            <li key={code}>
              <code>{code}</code> — {label}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>天平校准现状（只读，维护在「天平校准」页）</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>名称</th>
              <th>校准日</th>
              <th>有效期至</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td>{b.name}</td>
                <td>{b.calibratedOn}</td>
                <td>{b.validUntil}</td>
                <td>
                  <span className={b.valid ? "tag tag-ok" : "tag tag-bad"}>
                    {b.valid ? "有效" : "过期"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
