import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroupAnalysisAgainstChart } from '../lib/agent/ai-service.js';

test('validateGroupAnalysisAgainstChart - passes when all stars and palaces exist', () => {
  const chartData = {
    palaces: ['命宫', '夫妻宫', '官禄宫'],
    stars: ['七杀', '武曲', '天相'],
    sihua: ['化忌', '化禄']
  };
  const analysis = {
    conclusion: '流年官禄宫重叠大限夫妻宫，事业面临重要转折。',
    details: [
      '流年官禄宫重叠大限夫妻宫，本命命宫，说明事业与婚姻能量交织。',
      '宫内七杀、武曲化忌，提醒注意合作风险。'
    ]
  };
  const result = validateGroupAnalysisAgainstChart(analysis, chartData);
  assert.equal(result.valid, true);
});

test('validateGroupAnalysisAgainstChart - rejects hallucinated star', () => {
  const chartData = {
    palaces: ['命宫', '夫妻宫'],
    stars: ['七杀'],
    sihua: ['化忌']
  };
  const analysis = {
    conclusion: '紫微星坐镇命宫。',
    details: ['命宫有紫微独坐。']
  };
  const result = validateGroupAnalysisAgainstChart(analysis, chartData);
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('紫微'));
});
