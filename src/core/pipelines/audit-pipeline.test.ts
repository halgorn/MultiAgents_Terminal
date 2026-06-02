import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditPipeline, compactScanReport, fallbackAuditReport } from './audit-pipeline.js';
import { createRuntimePolicy } from '../runtime-policy.js';
import { CostTracker } from '../cost-tracker.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-pipeline-'));
  for (const sub of ['src', 'node_modules/pkg', 'dist', '.git', 'nested/app']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(join(dir, 'src/app.ts'), 'export function app() { return 1; }\n');
  writeFileSync(join(dir, 'src/app.test.ts'), 'test("x", () => {});\n');
  writeFileSync(join(dir, 'src/types.d.ts'), 'declare const x: string;\n');
  writeFileSync(join(dir, 'src/bundle.min.js'), 'var x=1;\n');
  writeFileSync(join(dir, 'src/large.py'), 'x = 1\n'.repeat(50_000));
  writeFileSync(join(dir, 'node_modules/pkg/index.ts'), 'export const ignored = true;\n');
  writeFileSync(join(dir, 'dist/out.js'), 'console.log(1);\n');
  writeFileSync(join(dir, 'nested/app/service.py'), 'def run():\n    return True\n');
  return dir;
}

function pipeline(cwd: string): AuditPipeline {
  return new AuditPipeline(cwd, createRuntimePolicy(), new CostTracker(), () => {}, () => {});
}

test('collectAuditStats filters generated, test, dependency, and oversized files', () => {
  const dir = makeRepo();
  try {
    const stats = pipeline(dir).collectAuditStats('.');

    assert.deepEqual(stats.auditFiles, ['nested/app/service.py', 'src/app.ts']);
    assert.equal(stats.oversizedFiles, 1);
    assert.equal(stats.byExtension['.ts'], 3);
    assert.equal(stats.byExtension['.js'], 1);
    assert.equal(stats.byExtension['.py'], 2);
    assert.ok(stats.ignoredDirs >= 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAuditStats respects target subdirectory', () => {
  const dir = makeRepo();
  try {
    const stats = pipeline(dir).collectAuditStats('nested');

    assert.deepEqual(stats.auditFiles, ['nested/app/service.py']);
    assert.equal(stats.totalFiles, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAuditStats scales across thousands of files without including ignored dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-scale-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });

    for (let i = 0; i < 2_100; i++) {
      writeFileSync(join(dir, 'src', `file-${i}.ts`), `export const value${i} = ${i};\n`);
    }
    for (let i = 0; i < 500; i++) {
      writeFileSync(join(dir, 'node_modules/pkg', `ignored-${i}.ts`), 'export const ignored = true;\n');
    }

    const started = Date.now();
    const stats = pipeline(dir).collectAuditStats('.');

    assert.equal(stats.auditFiles.length, 2_100);
    assert.equal(stats.auditFiles.some((file) => file.includes('node_modules')), false);
    assert.ok(Date.now() - started < 2_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compactScanReport limits findings and text size', () => {
  const report = compactScanReport({
    filesScanned: Array.from({ length: 100 }, (_, i) => `file-${i}.ts`),
    summary: 'summary '.repeat(200),
    findings: Array.from({ length: 20 }, (_, i) => ({
      file: `file-${i}.ts`,
      line: i + 1,
      severity: i % 2 === 0 ? 'critical' : 'low',
      category: 'security',
      finding: 'finding '.repeat(100),
      recommendation: 'recommendation '.repeat(100),
    })),
  }, 5);

  assert.equal(report.findings.length, 5);
  assert.equal(report.filesScanned.length, 80);
  assert.ok(report.summary.length <= 703);
  assert.ok(report.findings.every((finding) => finding.finding.length <= 363));
});

test('fallbackAuditReport deduplicates and ranks findings locally', () => {
  const report = fallbackAuditReport([
    {
      filesScanned: ['a.ts'],
      summary: 'first',
      findings: [{
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'testing',
        finding: 'duplicate',
        recommendation: 'fix',
      }],
    },
    {
      filesScanned: ['a.ts', 'b.ts'],
      summary: 'second',
      findings: [
        {
          file: 'a.ts',
          line: 1,
          severity: 'low',
          category: 'testing',
          finding: 'duplicate',
          recommendation: 'fix',
        },
        {
          file: 'b.ts',
          line: 2,
          severity: 'critical',
          category: 'security',
          finding: 'critical issue',
          recommendation: 'fix now',
        },
      ],
    },
  ], 42);

  assert.equal(report.totalFiles, 42);
  assert.equal(report.findings.length, 2);
  assert.equal(report.findings[0]?.severity, 'critical');
  assert.equal(report.criticalCount, 1);
  assert.equal(report.highCount, 0);
});
