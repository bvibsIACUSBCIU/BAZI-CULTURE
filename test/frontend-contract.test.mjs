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

test('六阶段服务端推演在界面中以明确阶段标签呈现', () => {
  assert.match(appJs, /SIX_STAGE_LABELS/);
  assert.match(appJs, /formatStageTitle/);
  assert.match(appJs, /6-Stage/);
  assert.doesNotMatch(appHtml, /20 位命理 Agent/);
});
