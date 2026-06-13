import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectIdentity, formatIdentityForPrompt } from './project-identity.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'proj-identity-'));
}

function writePkg(dir: string, data: object) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(data));
}

test('detectProjectIdentity: bin field → cli_tool', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-tool', bin: { 'my-tool': 'dist/index.js' }, dependencies: { commander: '^11.0.0' } });
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'cli_tool');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: react dependency → web_app', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-app', dependencies: { react: '^18', next: '^14' } });
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'web_app');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: express dependency → backend_api', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-api', dependencies: { express: '^4', prisma: '^5' } });
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'backend_api');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: anthropic sdk + agents/ dir → multi_agent_framework', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-agent', dependencies: { '@anthropic-ai/sdk': '^0.20' }, keywords: ['agent', 'ai'] });
    mkdirSync(join(dir, 'agents'));
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'multi_agent_framework');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: electron → desktop_app', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-desktop', dependencies: { electron: '^28' } });
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'desktop_app');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: pnpm workspace → monorepo', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'root', workspaces: ['packages/*'] });
    const id = detectProjectIdentity(dir);
    assert.equal(id.primary_type, 'monorepo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: Dockerfile → server execution model', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-api', dependencies: { express: '^4' } });
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20\n');
    const id = detectProjectIdentity(dir);
    assert.equal(id.execution_model, 'server');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: cli_tool → local execution model by default', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'my-cli', bin: { 'my-cli': 'dist/index.js' }, dependencies: { commander: '^11' } });
    const id = detectProjectIdentity(dir);
    assert.equal(id.execution_model, 'local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: confidence ≥ 50 when signal is strong', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'tool', bin: { tool: 'dist/index.js' }, dependencies: { commander: '^11' }, keywords: ['cli'] });
    const id = detectProjectIdentity(dir);
    assert.ok(id.confidence >= 50, `confidence was ${id.confidence}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: signals array is non-empty with a package.json', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'tool', bin: { tool: 'dist/index.js' }, dependencies: { commander: '^11' } });
    const id = detectProjectIdentity(dir);
    assert.ok(id.signals.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: trust_boundaries has all three trust levels', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'tool', bin: { tool: 'dist/index.js' }, dependencies: { commander: '^11' } });
    const id = detectProjectIdentity(dir);
    assert.ok(Array.isArray(id.trust_boundaries.trusted));
    assert.ok(Array.isArray(id.trust_boundaries.semi_trusted));
    assert.ok(Array.isArray(id.trust_boundaries.untrusted));
    assert.ok(id.trust_boundaries.trusted.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectIdentity: empty dir → fallback to npm_package, no throw', () => {
  const dir = makeDir();
  try {
    const id = detectProjectIdentity(dir);
    assert.equal(typeof id.primary_type, 'string');
    assert.ok(id.primary_type.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatIdentityForPrompt: includes primary_type', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'tool', bin: { tool: 'dist/index.js' }, dependencies: { commander: '^11' } });
    const id = detectProjectIdentity(dir);
    const prompt = formatIdentityForPrompt(id);
    assert.ok(prompt.includes('cli_tool'), `prompt: ${prompt}`);
    assert.ok(prompt.includes('Project Context'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatIdentityForPrompt: includes trust boundary labels', () => {
  const dir = makeDir();
  try {
    writePkg(dir, { name: 'tool', bin: { tool: 'dist/index.js' }, dependencies: { commander: '^11' } });
    const id = detectProjectIdentity(dir);
    const prompt = formatIdentityForPrompt(id);
    assert.ok(prompt.includes('Trusted inputs'));
    assert.ok(prompt.includes('Untrusted inputs'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
