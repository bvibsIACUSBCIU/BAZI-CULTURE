import test from 'node:test';
import assert from 'node:assert/strict';
import { run6StagePipeline } from '../lib/agent/multi-agent-pipeline.js';

test('run6StagePipeline executes 6 stages and emits standard SSE events', async () => {
  const events = [];
  const profile = { name: '韩立', birthYear: 2001, birthMonth: 1, birthDay: 1, birthHour: 6 };
  
  const result = await run6StagePipeline({
    profile,
    question: '2026年事业与财运如何？',
    onEvent: (evt) => events.push(evt)
  });

  assert.ok(result.chart);
  assert.ok(events.some(e => e.type === 'plan'));
  assert.ok(events.some(e => e.type === 'group_start'));
  assert.ok(events.some(e => e.type === 'group_done'));
  assert.ok(events.some(e => e.type === 'report_start'));
  assert.ok(events.some(e => e.type === 'report_done'));
  assert.ok(events.some(e => e.type === 'recommend'));
});
