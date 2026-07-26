# 八字文化研究版 MVP

独立项目目录：`bazi-culture-mvp`。本项目不继承旧
`ai-lucky-bot` 的 Vercel 关联、环境变量、人格测试、水晶、邀请解锁或
模拟财富逻辑。

这是一个中文、免费、受约束的八字文化研究智能体。当前版本优先验证
排盘正确性、资料可追溯性、隐私和安全表达，不追求完整断命功能。

## MVP 范围

- 公历出生日期；
- 可选出生时间；
- 首版固定使用 `Asia/Shanghai` (`UTC+8`)；
- 使用 `lunar-javascript@1.7.7` 确定性计算四柱；
- 输出四柱、日主、表层五行计数、透干与固定藏干十神；
- 确定性记录天干五合/相克、地支合冲刑害破及完整三合三会结构；
- 提供原局总览、事业、财富、情感四类受约束研读；
- 网页表单与 Telegram Bot 共用同一计算核心；
- 固定按钮、命令和自然语言问答分开路由；
- AI 只能读取白名单工具返回的确定性命盘摘要，不参与排盘；
- 会话默认 6 小时过期；配置 Upstash Redis 后支持跨实例会话；
- 排盘完成后不在会话中保留原始公历日期、时间和农历日期；
- Telegram update 去重、同一运行实例内按聊天串行处理，并限制 AI 调用频率；
- `/delete` 清除 Telegram 当前会话。

当前不提供：

- 格局、旺衰、用神、大运和流年断语；
- 财富、婚姻、健康或重大人生结果预测；
- 脱离当前命盘的开放式聊天；
- 人格测试、水晶、邀请解锁或付费功能；
- 海外时区、真太阳时和 23:00-00:59 换日计算。

## 当前网页体验闭环

网页 MVP 已收敛为一条不依赖账号的首次体验：

1. 用户可先查看一份不含个人资料的示例命盘；
2. 填写公历日期、可选出生时间与可选出生地；
3. 生成前再次核对输入与 UTC+8、出生地不参与计算等口径；
4. 查看确定性四柱、日主、表层五行与本次计算边界；
5. 从“原局总览”“事业研读”“财富研读”“情感研读”和“具体问题”入口调用受约束 AI；
6. 每段解释展示事实编号、结构依据、限制/反证、已审核规则或边界标签；
7. 用户可提交“有帮助、太笼统、与实际不符”三类匿名反馈；
8. 用户可重新排盘或清除当前页面中的命盘资料。

体验事件接口只记录白名单事件、反馈选择、是否为示例和服务端时间，
不会记录出生日期、出生时间、出生地、命盘或用户问题。

## 运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm test
```

网页/API 本地调试可以使用任意支持 Vercel Functions 的本地环境。

```bash
npm run dev:web
```

Telegram 长轮询：

```bash
cp .env.example .env
npm run dev
```

环境变量：

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_SECRET=
BOT_PUBLIC_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_FALLBACK_MODEL=
AI_TIMEOUT_MS=
AI_FALLBACK_TIMEOUT_MS=
AI_PROVIDER=
OPENAI_BASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

不配置 Upstash 时会自动退回单实例内存会话，适合本地测试，不适合
Vercel 多实例生产使用。Webhook 生产配置使用：

```bash
npm run set:webhook
```

## API

`POST /api/report`

```json
{
  "date": "1990-06-15",
  "time": "14:30",
  "timeKnown": true,
  "consent": true
}
```

`POST /api/ai-report` 支持 `topic`：

```json
{
  "date": "1990-06-15",
  "time": "14:30",
  "timeKnown": true,
  "consent": true,
  "topic": "career"
}
```

`topic` 可选值为 `overview`、`career`、`wealth`、`relationship`。

未知时间：

```json
{
  "date": "1990-06-15",
  "timeKnown": false,
  "consent": true
}
```

## Telegram

- `/start`：阅读说明并同意处理资料；
- `/bazi YYYY-MM-DD HH:mm`：直接生成；
- `/bazi YYYY-MM-DD unknown`：时间不详；
- `/method`：查看计算与资料口径；
- `/delete`：清除当前会话；
- `/cancel`：取消当前填写。

AI 解读、三个专题和连续追问由最小 Agent Runtime 处理。每轮最多调用两个白名单
工具；当前工具包括确定性排盘、命盘摘要、固定报告、计算口径和会话清除。

## 质量状态

这是测试版 MVP，不是完整命理产品。当前已经具备真实历法引擎集成测试、
Webhook 校验、去重、串行队列、会话 TTL 和基础费用限流。扩大测试前仍需：

- 至少 60 个排盘夹具，其中 20 个为边界案例；
- 配置跨实例 Redis，并验证故障恢复与数据删除；
- 海外时区与历史夏令时策略；
- 23:00-00:59 换日规则审核；
- 藏干、干支关系及事业/财富/情感规则卡的逐段来源复核；
- 日主旺衰、格局和用神方法的冲突登记与实现；
- 大运起运算法、顺逆规则和流年边界测试；
- 完整隐私、限流、成本与回滚机制。

资料审计与重建标准位于 `docs/rebuild/`，来源记录位于
`knowledge/sources/`。
