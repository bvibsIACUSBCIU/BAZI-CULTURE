# 两仪命理 AI 工作台 (bazi-culture-mvp)

两仪命理（bazi-culture-mvp）是一个基于 **八字历法引擎、紫微斗数、时家奇门遁甲与 20 命理 Agent 协作流水线** 的智能命理推演工作台。

系统采用了现代**三栏式纯黑深灰黑金视觉系统**（`app.html`），配合 EVM Web3 钱包签名认证、多命主档案管理、选中/创建命主后**直接实时渲染紫微斗数十二宫全景盘与八字干支**、以及 20-Agent 实时推演流。

---

## 🌟 核心特性与架构

### 1. 三栏式黑灰金工作台 (`app.html`)
- **纯黑深灰配色 (Black & Grey with Gold Accents)**：
  - 页面背景：纯暗黑 (`#09090b`)
  - 侧边栏与卡片：深灰 (`#121215` / `#18181c`)
  - 主要文字：亮白 (`#ffffff` / `#f4f4f5`)
  - 点缀色彩：琥珀金 (`#d3a85e` / `#e8c87a`) 用于选中 Tab 下划线、日主 Tag 与主要按钮
- **无 Emoji 严格规范**：前端界面与 Agent 步骤中零 Emoji 符号，采用标准古典中文字体与现代 Typography 布局。
- **三栏固定/自适应布局**：
  - **左侧边栏 (260px 固定)**：命主档案管理、历史对话流、收藏对话与账号状态。
  - **中间聊天窗口 (Flex)**：顶部命主快捷下拉切换、动态 20-Agent 思考推演链、气泡对话。等待状态下播放 CSS SVG「子丑寅卯 12 地支绕太极」无极旋转动画。
  - **右侧命盘分屏 (420px 宽屏固定)**：
    - `紫微斗数`（iztro 引擎驱动的十二宫全景盘，包含主星、吉凶化星、宫名、年龄段）
    - `八字奇门`（四柱干支、日主、五行多寡柱状图、藏干十神）
    - `分析报告`（Markdown 渲染全文，支持一键复制与导出 PDF）

### 2. 命主选择/创建后直接渲染命盘 (Instant Chart Rendering)
- **选择即排盘**：在左侧列表选中或弹窗创建命主（姓名、性别、公历/农历出生时间、出生地点）后，**无需发起提问，右侧命盘面板直接实时渲染**出完整的紫微斗数十二宫盘与八字四柱干支五行图。

### 3. EVM 钱包签名认证与全量持久化 (Web3 Auth & Storage)
- **MetaMask 签名登录**：支持 `personal_sign` 挑战签名鉴权。
- **全量持久化**：钱包登录后，命主档案与历史对话长期保存，再次登录或刷新页面自动恢复。

### 4. 20 命理 Agent 真实协作 Pipeline (SSE Streaming)
包含 20 个专项 Agent 的真实推演流水线（`lib/agent/multi-agent-pipeline.js`）：
- `coordinator`, `chart`, `bazi_struct`, `day_master`, `hidden_stem`, `ten_god`, `element_count`, `pattern`, `stem_branch`, `liu_nian`, `da_yun`, `career`, `wealth`, `relationship`, `health`, `knowledge`, `validator`, `reasoning`, `writer`, `summary`。
- 单次问答推演过程约束 ≥ 30 秒，前端实时展示步骤卡片与思考逻辑抽屉。

---

## 🛠️ 快速启动

### 启动开发服务器与全 API 支持
```bash
node scripts/web-dev.mjs
```
访问：[http://127.0.0.1:4173/app.html](http://127.0.0.1:4173/app.html)

### 运行单元测试
```bash
npm test
```
*包含 108 个单元测试与 SSE 流测试，100% 通过。*

### 运行端到端模拟测试
```bash
node --env-file=.env scripts/test-simulation.mjs
```
