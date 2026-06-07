import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { embedText } from '../infra/embeddings.js';
import { makeFixtureRepo, runSourceCli, SOURCE_CLI, WORKSPACE_ROOT, isolatedEnv } from '../test-utils/fixtures.js';

test('CLI exposes non-TTY menu fallback without hanging', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = runSourceCli(repo, ['menu']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Execute em um terminal interativo/);
    assert.match(result.stdout, /aion scan secrets/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI local search and memory index work on a fixture repo', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const search = runSourceCli(repo, ['search', 'semantic retrieval context', '--semantic', '--rebuild', '--limit', '3']);
    assert.equal(search.status, 0, search.stderr);
    assert.match(search.stdout, /src\/rag\.ts/);

    const index = runSourceCli(repo, ['memory', 'index']);
    assert.equal(index.status, 0, index.stderr);

    const query = runSourceCli(repo, ['memory', 'query', 'answerQuestion']);
    assert.equal(query.status, 0, query.stderr);
    assert.match(query.stdout, /src\/app\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI impact-local accepts a prompted menu target equivalent without AI', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = runSourceCli(repo, ['impact-local', 'src/rag.ts', '--rebuild', '--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /src\/rag\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI help, version, cwd validation, and audit dry-run work without providers', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const help = runSourceCli(repo, ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Commands:/);

    const version = runSourceCli(repo, ['--version']);
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

    const invalidCwd = runSourceCli(repo, ['--cwd', '/definitely/not/a/real/path', 'health']);
    assert.equal(invalidCwd.status, 1);
    assert.match(invalidCwd.stderr, /directory not found/);

    const dryRun = runSourceCli(repo, ['audit', '.', '--dry-run', '--max-files', '2']);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Audit dry run/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI local subcommands smoke without API keys or internet assumptions', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const scanSecrets = runSourceCli(repo, ['scan', 'secrets']);
    assert.equal(scanSecrets.status, 0, scanSecrets.stderr);
    assert.match(scanSecrets.stdout, /No hardcoded secrets detected/);

    const docsAnalyze = runSourceCli(repo, ['docs', 'analyze', '--json']);
    assert.equal(docsAnalyze.status, 0, docsAnalyze.stderr);
    assert.match(docsAnalyze.stdout, /"score"/);

    const cloudStatus = runSourceCli(repo, ['cloud', 'status']);
    assert.equal(cloudStatus.status, 0, cloudStatus.stderr);
    assert.match(cloudStatus.stdout, /Cloud provider detection/);

    const mcpTools = runSourceCli(repo, ['mcp', 'list-tools']);
    assert.equal(mcpTools.status, 0, mcpTools.stderr);
    assert.match(mcpTools.stdout, /search_memory/);

    const ciDryRun = runSourceCli(repo, ['ci', '.', '--dry-run']);
    assert.equal(ciDryRun.status, 0, ciDryRun.stderr);
    assert.match(ciDryRun.stdout, /"dryRun": true/);

    const setupStatus = runSourceCli(repo, ['setup', '--status']);
    assert.equal(setupStatus.status, 0, setupStatus.stderr);
    assert.match(setupStatus.stdout, /"prepared": false/);

    const copilotDry = runSourceCli(repo, ['copilot', 'safe', '--dry-run']);
    assert.equal(copilotDry.status, 0, copilotDry.stderr);
    assert.match(copilotDry.stdout, /Copilot workflow: Safe AI Guard/);
    assert.match(copilotDry.stdout, /aion audit \. --domains security,bugs --scanners 2 --max-files 30 --budget normal/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI reports expected errors for missing local indexes', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const memoryQuery = runSourceCli(repo, ['memory', 'query', 'anything']);
    assert.equal(memoryQuery.status, 1);
    assert.match(memoryQuery.stderr, /No repo index found/);

    const evalRetrieval = runSourceCli(repo, ['eval', 'retrieval']);
    assert.equal(evalRetrieval.status, 1);
    assert.match(evalRetrieval.stderr, /No golden set found/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI eval retrieval runs offline with local reranker and JSON output', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    mkdirSync(join(repo, '.ai-memory', 'eval'), { recursive: true });
    mkdirSync(join(repo, '.ai-runtime'), { recursive: true });
    writeFileSync(join(repo, '.ai-memory', 'eval', 'retrieval.json'), JSON.stringify({
      queries: [{ query: 'semantic retrieval context', expected: ['src/rag.ts'] }],
    }));
    writeFileSync(join(repo, '.ai-runtime', 'vectors.json'), JSON.stringify([
      {
        id: 'src/rag.ts:retrieveContext',
        vector: Array.from(embedText('semantic retrieval context retrieveContext', 500)),
        payload: { file: 'src/rag.ts', preview: 'semantic retrieval context retrieveContext' },
      },
    ]));

    const result = runSourceCli(repo, ['eval', 'retrieval', '--rerank', 'local', '--json']);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { recall3: number; rerankMode: string; results: Array<{ hitAt3: boolean }> };
    assert.equal(report.rerankMode, 'local');
    assert.equal(report.recall3, 1);
    assert.equal(report.results[0]?.hitAt3, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI assist and deploy commands create dry-run plans without remote side effects', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'assist-demo',
      scripts: {
        build: 'tsc',
        test: 'node --test',
        start: 'PORT=3050 node server.js',
      },
    }));

    const assist = runSourceCli(repo, ['assist', '--domain', 'demo.example.com']);
    assert.equal(assist.status, 0, assist.stderr);
    assert.match(assist.stdout, /Dry-run only/);
    assert.match(assist.stdout, /aion-ci\.yml/);

    const plan = runSourceCli(repo, ['deploy', 'plan', '--json', '--domain', 'demo.example.com']);
    assert.equal(plan.status, 0, plan.stderr);
    const parsed = JSON.parse(plan.stdout) as { healthcheckUrl: string; artifacts: Array<{ path: string }> };
    assert.equal(parsed.healthcheckUrl, 'http://demo.example.com/');
    assert.equal(parsed.artifacts.some((artifact) => artifact.path.includes('aion-deploy.yml')), true);

    const deployAssist = runSourceCli(repo, ['deploy', 'assist', '--domain', 'demo.example.com']);
    assert.equal(deployAssist.status, 0, deployAssist.stderr);
    assert.match(deployAssist.stdout, /Assist plan:/);
    assert.match(deployAssist.stdout, /Dry-run only/);

    const apply = runSourceCli(repo, ['deploy', 'apply', '--plan', join(repo, '.ai-runtime', 'assist', 'deploy-plan.json')]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /ssh \$\{SSH_USER\}@\$\{SSH_HOST\}/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI ci assist and deploy check expose safe failure modes', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const ciAssist = runSourceCli(repo, ['ci', 'assist']);
    assert.equal(ciAssist.status, 0, ciAssist.stderr);
    assert.match(ciAssist.stdout, /aion-ci\.yml/);

    const badCheck = runSourceCli(repo, ['deploy', 'check', 'file:///etc/passwd']);
    assert.equal(badCheck.status, 1);
    assert.match(badCheck.stdout, /Invalid healthcheck URL/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI setup command prepares project and can be reset', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const setup = runSourceCli(repo, ['setup', '--domain', 'bugs', '--budget', 'low', '--skip-semantic-rag']);
    assert.equal(setup.status, 0, setup.stderr);
    assert.match(setup.stdout, /Setup complete/);

    const status = runSourceCli(repo, ['setup', '--status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /"prepared": true/);
    assert.match(status.stdout, /"selectedScanners": 1/);

    const reset = runSourceCli(repo, ['setup', '--reset']);
    assert.equal(reset.status, 0, reset.stderr);
    assert.match(reset.stdout, /Setup state reset/);

    const statusAfterReset = runSourceCli(repo, ['setup', '--status']);
    assert.equal(statusAfterReset.status, 0, statusAfterReset.stderr);
    assert.match(statusAfterReset.stdout, /"prepared": false/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI setup with semantic rag falls back to local embeddings when remote key is invalid', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', SOURCE_CLI, '--cwd', repo, 'setup', '--domain', 'bugs', '--budget', 'low', '--semantic-rag'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: isolatedEnv({ OPENAI_API_KEY: 'ollama' }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fallback local/i);

    const status = runSourceCli(repo, ['setup', '--status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /"prepared": true/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
