import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProviders } from './cloud-analyzer.js';
import { displayProjectName } from './project-name.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── detectProviders ───────────────────────────────────────────────────────────

test('detectProviders: no env vars → empty list', () => {
  withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_PROFILE: undefined, AZURE_SUBSCRIPTION_ID: undefined, AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined, GOOGLE_CLOUD_PROJECT: undefined }, () => {
    assert.deepEqual(detectProviders(), []);
  });
});

test('detectProviders: AWS_ACCESS_KEY_ID → aws detected', () => {
  withEnv({ AWS_ACCESS_KEY_ID: 'test-key-value', AWS_PROFILE: undefined, AZURE_SUBSCRIPTION_ID: undefined, AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined, GOOGLE_CLOUD_PROJECT: undefined }, () => {
    const providers = detectProviders();
    assert.ok(providers.includes('aws'));
    assert.ok(!providers.includes('azure'));
    assert.ok(!providers.includes('gcp'));
  });
});

test('detectProviders: AWS_PROFILE → aws detected', () => {
  withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_PROFILE: 'default', AZURE_SUBSCRIPTION_ID: undefined, AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined, GOOGLE_CLOUD_PROJECT: undefined }, () => {
    assert.ok(detectProviders().includes('aws'));
  });
});

test('detectProviders: AZURE_SUBSCRIPTION_ID → azure detected', () => {
  withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_PROFILE: undefined, AZURE_SUBSCRIPTION_ID: 'sub-123', AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined, GOOGLE_CLOUD_PROJECT: undefined }, () => {
    assert.ok(detectProviders().includes('azure'));
  });
});

test('detectProviders: GOOGLE_CLOUD_PROJECT → gcp detected', () => {
  withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_PROFILE: undefined, AZURE_SUBSCRIPTION_ID: undefined, AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined, GOOGLE_CLOUD_PROJECT: 'my-project' }, () => {
    assert.ok(detectProviders().includes('gcp'));
  });
});

test('detectProviders: all three providers detected when all vars set', () => {
  withEnv({ AWS_ACCESS_KEY_ID: 'key', AZURE_SUBSCRIPTION_ID: 'sub', GOOGLE_CLOUD_PROJECT: 'proj', AWS_PROFILE: undefined, AZURE_TENANT_ID: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined }, () => {
    const providers = detectProviders();
    assert.ok(providers.includes('aws'));
    assert.ok(providers.includes('azure'));
    assert.ok(providers.includes('gcp'));
    assert.equal(providers.length, 3);
  });
});

// ── displayProjectName ────────────────────────────────────────────────────────

test('displayProjectName: extracts last path segment from cwd', () => {
  assert.equal(displayProjectName('/home/user/my-awesome-project'), 'my-awesome-project');
});

test('displayProjectName: works with Windows-style backslash paths', () => {
  assert.equal(displayProjectName('C:\\Users\\user\\myapp'), 'myapp');
});

test('displayProjectName: falls back to fallback param for empty string', () => {
  assert.equal(displayProjectName('', 'unknown'), 'unknown');
});

test('displayProjectName: special-cases MultiAgents_Terminal → Aion', () => {
  const result = displayProjectName('/home/user/MultiAgents_Terminal');
  assert.equal(result, 'Aion');
});

test('displayProjectName: default fallback is "project"', () => {
  assert.equal(displayProjectName(''), 'project');
});

test('displayProjectName: short path segments preserved as-is', () => {
  assert.equal(displayProjectName('/apps/api'), 'api');
});
