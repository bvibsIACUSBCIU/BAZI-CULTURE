import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBazi } from '../lib/metaphysics/bazi-engine.js';

test('Bazi Engine - Four Pillars & Day Master calculation', async () => {
  const chart = await calculateBazi({
    date: '1990-06-15',
    time: '14:30',
    timeKnown: true
  });

  assert.ok(chart.pillars);
  assert.ok(chart.pillars.year);
  assert.ok(chart.pillars.month);
  assert.ok(chart.pillars.day);
  assert.ok(chart.pillars.time);

  assert.ok(chart.dayMaster);
  assert.ok(chart.dayMaster.stem);
  assert.ok(chart.dayMaster.element);

  assert.ok(chart.elementCounts);
  assert.equal(typeof chart.elementCounts['金'], 'number');
  assert.equal(typeof chart.elementCounts['木'], 'number');
  assert.equal(typeof chart.elementCounts['水'], 'number');
  assert.equal(typeof chart.elementCounts['火'], 'number');
  assert.equal(typeof chart.elementCounts['土'], 'number');
});

test('Bazi Engine - Unknown birth time omits time pillar', async () => {
  const chart = await calculateBazi({
    date: '2001-01-01',
    timeKnown: false
  });

  assert.ok(chart.pillars.year);
  assert.ok(chart.pillars.month);
  assert.ok(chart.pillars.day);
  assert.equal(chart.pillars.time, null);
});
