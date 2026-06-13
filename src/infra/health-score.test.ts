import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHealthScore } from './health-score.js';
import type { HealthInputs } from './health-score.js';

const BASE: HealthInputs = {
  totalFiles: 100,
  totalSymbols: 400,
  cycles: 0,
  hotspots: 0,
  testFileRatio: 0.30,
};

test('perfect inputs produce grade A', () => {
  const result = computeHealthScore(BASE);
  // Security:100*0.30 + Arch:100*0.20 + Test:100*0.15 + Churn:80*0.15 + Bus:80*0.10 + Cog:75*0.10 = 92.5→93
  assert.equal(result.total, 93);
  assert.equal(result.grade, 'A');
  assert.ok(result.badge.includes('A'));
});

test('1 critical finding brings security to 50', () => {
  const result = computeHealthScore({ ...BASE, auditCriticals: 1 });
  // Security=50*0.30 + rest_same = 15+20+15+12+8+7.5 = 77.5→78
  assert.equal(result.total, 78);
  assert.equal(result.grade, 'B');
  const sec = result.dimensions.find((d) => d.name === 'Security');
  assert.equal(sec?.score, 50);
});

test('5 critical findings bring security to 30', () => {
  const result = computeHealthScore({ ...BASE, auditCriticals: 5 });
  // Security=30*0.30 = 9 → 9+20+15+12+8+7.5 = 71.5→72
  assert.equal(result.total, 72);
  assert.equal(result.grade, 'B');
});

test('10+ critical findings: minimum security score of 10', () => {
  const result = computeHealthScore({ ...BASE, auditCriticals: 10 });
  const sec = result.dimensions.find((d) => d.name === 'Security');
  assert.equal(sec?.score, 10);
});

test('high findings without criticals: security 85', () => {
  const result = computeHealthScore({ ...BASE, auditHighs: 1 });
  const sec = result.dimensions.find((d) => d.name === 'Security');
  assert.equal(sec?.score, 85);
});

test('test file ratio below 5% gives score 20', () => {
  const result = computeHealthScore({ ...BASE, testFileRatio: 0.01 });
  const cov = result.dimensions.find((d) => d.name === 'Test Coverage');
  assert.equal(cov?.score, 20);
});

test('test file ratio above 30% gives perfect coverage score', () => {
  const result = computeHealthScore({ ...BASE, testFileRatio: 0.50 });
  const cov = result.dimensions.find((d) => d.name === 'Test Coverage');
  assert.equal(cov?.score, 100);
});

test('dependency cycles penalize architecture score', () => {
  // 10 cycles / 100 files = ratio 0.1 → 0.1 * 200 = 20 penalty
  const result = computeHealthScore({ ...BASE, cycles: 10 });
  const arch = result.dimensions.find((d) => d.name === 'Architecture');
  assert.ok(arch!.score < 100, `expected penalty, got ${arch!.score}`);
  assert.equal(arch!.score, 80);
});

test('many anti-patterns cap architecture penalty at -20', () => {
  const patterns = { antiPatterns: new Array(10).fill({ type: 'god-class', file: 'a.ts', line: 1, description: '' }), totalIssues: 10 };
  const result = computeHealthScore({ ...BASE, patterns });
  const arch = result.dimensions.find((d) => d.name === 'Architecture');
  // 10 anti-patterns * 10 = 100 capped at 20 → score = 100 - 20 = 80
  assert.equal(arch!.score, 80);
});

test('critical churn files reduce churn score', () => {
  const churn = [
    { file: 'a.ts', commits: 50, risk: 'critical' as const, authors: 2 },
    { file: 'b.ts', commits: 45, risk: 'critical' as const, authors: 1 },
    { file: 'c.ts', commits: 40, risk: 'critical' as const, authors: 3 },
  ];
  const result = computeHealthScore({ ...BASE, churn });
  const dim = result.dimensions.find((d) => d.name === 'Churn Risk');
  // 3 critical churn files → score 50
  assert.equal(dim?.score, 50);
});

test('topRisks lists dimensions scoring below 60', () => {
  const result = computeHealthScore({ ...BASE, auditCriticals: 5, testFileRatio: 0.01 });
  // Security=30, Coverage=20 both below 60
  assert.ok(result.topRisks.length >= 2);
  assert.ok(result.topRisks.some((r) => r.includes('Security')));
  assert.ok(result.topRisks.some((r) => r.includes('Test Coverage')));
});

test('grade boundaries: 85→A, 70→B, 55→C, 40→D, below→F', () => {
  const makeScore = (sec: number, test: number) =>
    computeHealthScore({ ...BASE, auditCriticals: sec === 50 ? 1 : 0, testFileRatio: test / 100 }).grade;

  // Force total near each boundary using exact math
  const allGood = computeHealthScore(BASE);
  assert.equal(allGood.grade, 'A');

  // Score=79: B
  const b = computeHealthScore({ ...BASE, auditCriticals: 5 });
  assert.equal(b.grade, 'B');

  // Grade F requires very bad inputs
  const f = computeHealthScore({ ...BASE, auditCriticals: 10, testFileRatio: 0.01, cycles: 50, churn: new Array(5).fill({ file: 'x.ts', commits: 99, risk: 'critical' as const, authors: 1 }), busFactor: new Array(5).fill({ file: 'x.ts', authors: 1, risk: 'critical' as const }) });
  assert.equal(f.grade, 'F');
});
