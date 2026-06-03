import type { ChurnEntry, BusFactorEntry } from './git-analysis.js';
import type { CognitiveEntry } from './code-metrics.js';
import type { PatternReport } from './pattern-detect.js';

export interface HealthInputs {
  totalFiles: number;
  totalSymbols: number;
  cycles: number;
  hotspots: number;
  testFileRatio: number;         // test files / total files
  churn?: ChurnEntry[];
  busFactor?: BusFactorEntry[];
  cognitiveLoad?: CognitiveEntry[];
  patterns?: PatternReport;
  auditCriticals?: number;
  auditHighs?: number;
}

export interface HealthDimension {
  name: string;
  score: number;        // 0–100
  weight: number;       // sum = 1.0
  detail: string;
}

export interface HealthScore {
  total: number;        // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: HealthDimension[];
  topRisks: string[];
  badge: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function securityScore(criticals = 0, highs = 0): number {
  if (criticals >= 10) return 10;
  if (criticals >= 5) return 30;
  if (criticals >= 1) return 50;
  if (highs >= 10) return 60;
  if (highs >= 5) return 70;
  if (highs >= 1) return 85;
  return 100;
}

function testScore(ratio: number): number {
  if (ratio >= 0.3) return 100;
  if (ratio >= 0.2) return 80;
  if (ratio >= 0.1) return 60;
  if (ratio >= 0.05) return 40;
  return 20;
}

function architectureScore(cycles: number, hotspots: number, totalFiles: number, antiPatterns: number): number {
  let score = 100;
  const cycleRatio = cycles / Math.max(totalFiles, 1);
  score -= Math.min(40, cycleRatio * 200);
  score -= Math.min(20, antiPatterns * 10);
  score -= Math.min(10, (hotspots / Math.max(totalFiles, 1)) * 100);
  return clamp(score);
}

function churnScore(churn: ChurnEntry[]): number {
  const criticals = churn.filter((c) => c.risk === 'critical').length;
  const highs = churn.filter((c) => c.risk === 'high').length;
  if (criticals >= 5) return 30;
  if (criticals >= 2) return 50;
  if (highs >= 5) return 65;
  if (highs >= 2) return 80;
  return 100;
}

function busFactorScore(busFactor: BusFactorEntry[]): number {
  const criticals = busFactor.filter((b) => b.risk === 'critical').length;
  const highs = busFactor.filter((b) => b.risk === 'high').length;
  if (criticals >= 5) return 20;
  if (criticals >= 2) return 40;
  if (highs >= 5) return 60;
  if (highs >= 2) return 75;
  return 100;
}

function cognitiveScore(entries: CognitiveEntry[]): number {
  if (entries.length === 0) return 80;
  const avgScore = entries.slice(0, 10).reduce((s, e) => s + e.score, 0) / Math.min(entries.length, 10);
  if (avgScore >= 50) return 30;
  if (avgScore >= 30) return 55;
  if (avgScore >= 15) return 75;
  return 95;
}

function gradeFrom(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function computeHealthScore(inputs: HealthInputs): HealthScore {
  const dimensions: HealthDimension[] = [
    {
      name: 'Security',
      score: securityScore(inputs.auditCriticals, inputs.auditHighs),
      weight: 0.30,
      detail: `${inputs.auditCriticals ?? 0} critical, ${inputs.auditHighs ?? 0} high findings`,
    },
    {
      name: 'Architecture',
      score: architectureScore(inputs.cycles, inputs.hotspots, inputs.totalFiles, inputs.patterns?.antiPatterns.length ?? 0),
      weight: 0.20,
      detail: `${inputs.cycles} cycles, ${inputs.hotspots} hotspots, ${inputs.patterns?.antiPatterns.length ?? 0} anti-patterns`,
    },
    {
      name: 'Test Coverage',
      score: testScore(inputs.testFileRatio),
      weight: 0.15,
      detail: `${Math.round(inputs.testFileRatio * 100)}% test file ratio`,
    },
    {
      name: 'Churn Risk',
      score: inputs.churn ? churnScore(inputs.churn) : 80,
      weight: 0.15,
      detail: inputs.churn ? `${inputs.churn.filter((c) => c.risk === 'critical' || c.risk === 'high').length} high-churn files` : 'no git data',
    },
    {
      name: 'Bus Factor',
      score: inputs.busFactor ? busFactorScore(inputs.busFactor) : 80,
      weight: 0.10,
      detail: inputs.busFactor ? `${inputs.busFactor.filter((b) => b.risk === 'critical').length} single-author critical files` : 'no git data',
    },
    {
      name: 'Maintainability',
      score: inputs.cognitiveLoad ? cognitiveScore(inputs.cognitiveLoad) : 75,
      weight: 0.10,
      detail: inputs.cognitiveLoad ? `avg cognitive score: ${Math.round(inputs.cognitiveLoad.slice(0, 10).reduce((s, e) => s + e.score, 0) / Math.min(inputs.cognitiveLoad.length, 10))}` : 'no data',
    },
  ];

  const total = Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0));
  const grade = gradeFrom(total);

  const topRisks = dimensions
    .filter((d) => d.score < 60)
    .sort((a, b) => a.score - b.score)
    .map((d) => `${d.name}: ${d.score}/100 — ${d.detail}`);

  const color = total >= 85 ? '🟢' : total >= 70 ? '🟡' : total >= 55 ? '🟠' : '🔴';
  const badge = `${color} Health: ${total}/100 (${grade})`;

  return { total, grade, dimensions, topRisks, badge };
}
