import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const appHtml = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

test('前端不含名字驱动的伪造命盘和客户端模拟 Agent 输出', () => {
  assert.doesNotMatch(appJs, /isWangling|isHanli|runClientAgentSimulation/);
  assert.match(appJs, /safeFetchBaziApi/);
  assert.match(appJs, /fetch\('\/api\/chat'/);
});

test('历史报告回载保留摘要并提供回到当前确定命盘的证据链接', () => {
  assert.match(appJs, /function renderReportEvidenceLink/);
  assert.match(appJs, /renderReportEvidenceLink\(s\.chartSummary\)/);
  assert.match(appJs, /s\.summary/);
  assert.match(appHtml, /id="report-chart-evidence"/);
  assert.match(appCss, /\.report-chart-evidence/);
});

test('六阶段服务端推演使用自然语言标签，不暴露内部 Stage 编号', () => {
  assert.match(appJs, /SIX_STAGE_LABELS/);
  assert.match(appJs, /formatStageTitle/);
  assert.doesNotMatch(appJs, /Stage \$\{index \+ 1\}/);
  assert.doesNotMatch(appJs, /等待服务端事件/);
  assert.doesNotMatch(appHtml, /20 位命理 Agent/);
});

test('阶段进度仅由服务端事件逐步插入，并可展开查看每一步详情', () => {
  assert.match(appJs, /type === 'phase_start'/);
  assert.match(appJs, /type === 'phase_done'/);
  assert.match(appJs, /function createSequentialPipelineStage/);
  assert.match(appJs, /function appendStageDetail/);
  assert.match(appJs, /details\.open/);
  assert.match(appJs, /进行中/);
  assert.match(appCss, /\.pipeline-stage\.running \.pipeline-stage-state::before/);
  assert.match(appCss, /@keyframes pipeline-spin/);
});

test('聊天消息使用两仪八卦头像和抽象用户头像', () => {
  assert.match(appJs, /function createMessageAvatar/);
  assert.match(appJs, /chat-message-row user-message-row/);
  assert.match(appJs, /chat-message-row assistant-message-row/);
  assert.match(appJs, /'☯'/);
  assert.match(appCss, /\.chat-message-avatar/);
  assert.match(appCss, /\.assistant-avatar/);
  assert.match(appCss, /\.user-avatar/);
});

test('工作台核心静态资源使用发布版本参数，避免浏览器继续执行旧缓存', () => {
  assert.match(appHtml, /href="app\.css\?v=[^"]+"/);
  assert.match(appHtml, /src="app\.js\?v=[^"]+"/);
});
