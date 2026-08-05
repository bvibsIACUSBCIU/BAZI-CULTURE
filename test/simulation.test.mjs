import test from 'node:test';
import assert from 'node:assert/strict';
import { run6StagePipeline } from '../lib/agent/multi-agent-pipeline.js';

test('End-to-End Simulation Test - 6-Stage Pipeline & Dynamic Reading', async () => {
  const profile = {
    name: '韩立',
    date: '1990-06-15',
    time: '14:30',
    gender: '男',
    timeKnown: true
  };

  const events = [];
  const result = await run6StagePipeline({
    profile,
    question: '我的事业方向与财运发展如何？',
    onEvent: (evt) => events.push(evt)
  });

  assert.ok(result.chart);
  assert.ok(result.chart.dayMaster);
  assert.ok(events.some(e => e.type === 'chart_ready'));
  assert.ok(events.some(e => e.type === 'plan'));
  assert.ok(events.some(e => e.type === 'group_start'));
  assert.ok(events.some(e => e.type === 'group_done'));
  assert.ok(events.some(e => e.type === 'report_start'));
  assert.ok(events.some(e => e.type === 'report_done'));
  assert.ok(events.some(e => e.type === 'recommend'));
  assert.ok(result.report.includes('运势分析'));
});
