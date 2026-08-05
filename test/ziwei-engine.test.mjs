import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateZiwei } from '../lib/metaphysics/ziwei-engine.js';

test('Ziwei Engine - 12 Palaces IzTro Chart Calculation', async () => {
  const chart = await calculateZiwei({
    date: '1990-06-15',
    time: '14:30',
    gender: '男'
  });

  assert.equal(chart.system, 'ziwei');
  assert.ok(Array.isArray(chart.palaces));
  assert.equal(chart.palaces.length, 12);

  const mingPalace = chart.palaces.find(p => p.name === '命宫');
  assert.ok(mingPalace, 'Should contain 命宫');
  assert.ok(mingPalace.heavenlyStem);
  assert.ok(mingPalace.earthlyBranch);

  const names = chart.palaces.map(p => p.name);
  assert.ok(names.includes('兄弟'));
  assert.ok(names.includes('夫妻'));
  assert.ok(names.includes('财帛'));
  assert.ok(names.includes('官禄'));
});
