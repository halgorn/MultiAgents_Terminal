import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanCurrentSecrets, measureCognitiveLoad } from './code-metrics.js';
import { loadIgnorePatterns } from './aion-ignore.js';
import { semgrepProcessEnv } from './semgrep.js';
import { runLocalQA } from './local-qa.js';
import { createRuntimePolicy } from '../core/runtime-policy.js';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aion-security-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}

test('secrets scanner catches real-looking secrets and ignores commented false positives', () => {
  const repo = makeRepo();
  try {
    const apiKeyName = 'api' + '_key';
    const apiKeyValue = '12345678' + '90abcdef';
    const tokenValue = 'ghp_' + '123456789012345678' + '901234567890123456';
    writeFileSync(join(repo, 'src', 'secrets.ts'), [
      `// ${apiKeyName} = "this-comment-should-not-count"`,
      `const ${apiKeyName} = "${apiKeyValue}";`,
      `const token = "${tokenValue}";`,
    ].join('\n'));

    const hits = scanCurrentSecrets(repo);

    assert.deepEqual(hits.map((hit) => hit.pattern).sort(), ['github-token', 'hardcoded-api-key']);
    assert.equal(hits.some((hit) => hit.preview.includes('comment')), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('large repository scans stay bounded to avoid runaway memory and time', () => {
  const repo = makeRepo();
  try {
    for (let i = 0; i < 330; i++) {
      writeFileSync(join(repo, 'src', `file-${i}.ts`), `export const value${i} = ${i};\n`);
    }

    const cognitive = measureCognitiveLoad(repo, 500);

    assert.equal(cognitive.length, 300);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('aionignore skips unsafe ReDoS-shaped patterns and keeps safe patterns', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, '.aionignore'), [
      'dist/**',
      '*'.repeat(500),
      Array.from({ length: 80 }, () => '*').join('/'),
    ].join('\n'));

    const patterns = loadIgnorePatterns(repo);

    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.test('dist/app.js'), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('semgrep subprocess env strips provider, cloud, and npm token secrets', () => {
  const previous = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    NPM_TOKEN: process.env.NPM_TOKEN,
  };
  process.env.ANTHROPIC_API_KEY = 'secret';
  process.env.AWS_SECRET_ACCESS_KEY = 'cloud-secret';
  process.env.NPM_TOKEN = 'npm-secret';
  try {
    const env = semgrepProcessEnv();

    assert.equal(env['ANTHROPIC_API_KEY'], undefined);
    assert.equal(env['AWS_SECRET_ACCESS_KEY'], undefined);
    assert.equal(env['NPM_TOKEN'], undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('local QA falls back from shell-injection commands to whitelisted defaults', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      scripts: {
        build: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(0)"',
      },
    }));
    const patch: PatchReport = {
      filesChanged: ['src/app.ts'],
      diff: 'diff',
      buildCommand: 'npm run build; echo pwned',
      testCommand: 'npm test && echo pwned',
      description: 'test',
      risksIntroduced: [],
    };
    const evidence: EvidenceReport = {
      reproduced: true,
      confidence: 90,
      logs: ['secret reproduction log '.repeat(200)],
      files: [{ path: 'src/app.ts', line: 1, snippet: 'x' }],
      summary: 'test',
    };

    const result = runLocalQA(repo, patch, evidence, createRuntimePolicy({ maxOutputChars: 600 }));

    assert.equal(result.buildOk, true);
    assert.equal(result.testsOk, true);
    assert.equal(result.testOutput.includes('pwned'), false);
    assert.equal(result.testOutput.includes('[truncated:'), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
