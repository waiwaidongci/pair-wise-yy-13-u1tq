# hxyfront-62012 回潮检测与克重放行台

染整实验室的回潮（含水率）检测与克重放行工位前端：从开具检测单、烘干称重录入、规则评定、
复核裁定到检测履历留档的完整闭环。数据持久化在浏览器 localStorage，刷新与多标签间保持一致。

## 业务规则

- **一批一单**：同一批只允许存在一张未结束检测单（检测中 / 待复核），重复开单沿用首张。
- **要素齐全才可提交**：烘箱编号、烘干温度、烘干时长、烘前初重、两次称重，六项缺一不可。
- **只进待复核，不得放行克重**：
  - 称重天平校准已过期；
  - 两次称重相对偏差 `|d₁−d₂| / 均值 > 0.5%`；
  - 修正克重偏离目标允许区间（默认 ±3%，可按批次配置）等异常。
- **更正即失效重算，旧结论留档**：
  - 更正已放行单的烘干/称重记录 → 原放行立即失效、按规则重算；
  - 更正天平校准记录 → 所有使用该天平的已评定单连锁失效重算；
  - 每次失效记录原因（DRYING / CALIBRATION / RETURN / REEVALUATE）与时间，结论不覆盖删除。
- **复核留痕**：复核台只能「裁定放行（必填说明）」或「退回检测」，强制放行带操作人与说明。
- **幂等**：重复点击或并发提交携带同一提交键，只执行一次并沿用首次结果。

## 计算口径

- 实测回潮率 =（烘前初重 − 两次干重均值）÷ 两次干重均值 × 100%
- 干态克重 = 两次干重均值 ÷ 取样面积（m²）
- 修正克重 = 干态克重 ×（1 + 公称回潮率 ÷ 100）

## 架构：规则 / 记录 / 页面分层

- `src/domain/` 规则层：`types.ts` 领域类型；`rules.ts` 规则常量与纯函数评定引擎，无 React、无存储依赖。
- `src/store/` 记录层：`store.ts` 唯一事实来源（localStorage 持久化、Web Locks 跨标签串行化、
  幂等键、审计流），`seed.ts` 演示数据，`selectors.ts` 只读视图。
- `src/pages/` 与 `src/components/` 页面层：放行规则、批次台、检测台、复核队列、检测履历、天平校准。
- `scripts/test-rules.ts`、`scripts/test-store.ts` 无头测试（esbuild 打包后由 node 执行）。

## 本地运行

```bash
npm install
npm run dev
```

开发端口：62012

类型检查与构建：

```bash
npx tsc --noEmit
npm run build
```

规则与流转测试：

```bash
node_modules/.bin/esbuild scripts/test-rules.ts --bundle --platform=node --format=esm --outfile=scripts/.t.mjs && node scripts/.t.mjs && rm scripts/.t.mjs
node_modules/.bin/esbuild scripts/test-store.ts --bundle --platform=node --format=esm --outfile=scripts/.t.mjs && node scripts/.t.mjs && rm scripts/.t.mjs
```

## 技术栈

React 19 + Vite 7 + TypeScript（严格模式），无额外运行时依赖。
