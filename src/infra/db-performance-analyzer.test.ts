import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeFixtureRepo } from '../test-utils/fixtures.js';
import { analyzeDatabase } from './db-analyzer.js';
import { analyzePerformance } from './performance-analyzer.js';

test('database analyzer projects pagination, pooling, and relation loading risks', () => {
  const cwd = makeFixtureRepo('aion-db-risk-');
  try {
    mkdirSync(join(cwd, 'prisma'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@prisma/client': '5.0.0', pg: '8.0.0' } }));
    writeFileSync(join(cwd, 'prisma', 'schema.prisma'), [
      'model User {',
      '  id String @id',
      '  email String',
      '  posts Post[]',
      '}',
      'model Post { id String @id user User @relation(fields: [userId], references: [id]) userId String @@index([userId]) }',
    ].join('\n'));
    writeFileSync(join(cwd, 'src', 'users.ts'), [
      'import { PrismaClient } from "@prisma/client";',
      'const prisma = new PrismaClient({ datasources: {} });',
      'export async function listUsers() {',
      '  return prisma.user.findMany({ include: { posts: true }, take: 25, skip: 0 });',
      '}',
      'export const pool = { connectionLimit: 10 };',
    ].join('\n'));

    const report = analyzeDatabase(cwd);
    assert.equal(report.ormSignals.includes('Prisma'), true);
    assert.equal(report.indexSignals > 0, true);
    assert.equal(report.paginationSignals > 0, true);
    assert.equal(report.poolSignals > 0, true);
    assert.equal(report.relationRiskSignals > 0, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('performance analyzer detects uncached fetch and client rendering pressure', () => {
  const cwd = makeFixtureRepo('aion-perf-risk-');
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
    for (let i = 0; i < 9; i++) {
      writeFileSync(join(cwd, 'src', `widget-${i}.tsx`), `'use client';\nexport function Widget${i}(){ return null; }\n`);
    }
    writeFileSync(join(cwd, 'src', 'feed.ts'), [
      'export async function feed() {',
      '  const data = await fetch("https://example.com/api/feed");',
      '  return data.json();',
      '}',
    ].join('\n'));

    const report = analyzePerformance(cwd, []);
    assert.equal(report.clientRenderSignals, 9);
    assert.equal(report.uncachedFetchSignals, 1);
    assert.equal(report.issues.some((issue) => issue.area === 'Rendering'), true);
    assert.equal(report.issues.some((issue) => issue.area === 'Data fetching'), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
