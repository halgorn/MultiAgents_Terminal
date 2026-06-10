import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProject } from './project-detector.js';
import { buildAssistPlan, validateAssistPlan } from './assist-plan.js';
import { generateCiWorkflow, generateNginxConfig } from './generators/artifacts.js';
import { buildAssistAiPrompt, generateAiAssistPlan } from './ai-generator.js';
import { buildSshCommands, executeRemotePlan, runHealthcheck, validateRemoteStep } from './remote-executor.js';

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aion-assist-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'demo-app',
    scripts: {
      build: 'vite build',
      test: 'vitest run',
      lint: 'eslint .',
      start: 'PORT=4173 node server.js',
    },
  }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  writeFileSync(join(dir, 'Dockerfile'), 'FROM node:22\n');
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}

function makeBin(name: string, body: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'aion-assist-bin-'));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, 'utf8');
  chmodSync(file, 0o755);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('detectProject identifies Node scripts, package manager, runtime, git, and port', () => {
  const dir = makeProject();
  try {
    const detection = detectProject(dir);

    assert.equal(detection.name, 'demo-app');
    assert.equal(detection.packageManager, 'npm');
    assert.equal(detection.runtime, 'dockerfile');
    assert.equal(detection.buildCommand, 'npm run build');
    assert.equal(detection.testCommand, 'npm test');
    assert.equal(detection.lintCommand, 'npm run lint');
    assert.equal(detection.port, 4173);
    assert.equal(detection.hasGit, true);
    assert.equal(detection.hasDockerfile, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildAssistPlan generates valid CI, deploy, nginx, scripts, and required secrets', () => {
  const dir = makeProject();
  try {
    const plan = buildAssistPlan(dir, { domain: 'app.example.com', deployPath: '/opt/demo-app' });

    assert.deepEqual(validateAssistPlan(plan), []);
    assert.equal(plan.requiredSecrets.includes('SSH_PRIVATE_KEY'), true);
    assert.equal(plan.artifacts.some((artifact) => artifact.path === '.github/workflows/aion-ci.yml'), true);
    assert.match(generateCiWorkflow(plan), /node: \[18, 20, 22\]/);
    assert.match(generateCiWorkflow(plan), /aion scan seo --markdown --output aion-seo\.md/);
    assert.match(generateCiWorkflow(plan), /GITHUB_STEP_SUMMARY/);
    assert.match(generateNginxConfig(plan), /server_name app\.example\.com/);
    assert.equal(plan.remoteSteps.some((step) => step.command.includes('curl --fail')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateCiWorkflow can include an SEO score gate', () => {
  const dir = makeProject();
  try {
    const plan = buildAssistPlan(dir, { mode: 'ci', ciSeoFailUnder: 75 });
    assert.match(generateCiWorkflow(plan), /aion scan seo --markdown --output aion-seo\.md --fail-under 75/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AI prompt references secret names but never includes secret values', () => {
  const dir = makeProject();
  try {
    const plan = buildAssistPlan(dir);
    const prompt = buildAssistAiPrompt(plan);

    assert.match(prompt, /SSH_PRIVATE_KEY/);
    assert.doesNotMatch(prompt, /BEGIN .*PRIVATE KEY/);
    assert.doesNotMatch(prompt, /sk-[a-zA-Z0-9]{20,}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateAiAssistPlan accepts safe Claude CLI JSON and rejects dangerous commands', async () => {
  const dir = makeProject();
  const fake = makeBin('claude', `
const prompt = process.argv.join(' ');
const payload = prompt.includes('danger')
  ? { remoteSteps: [{ name: 'bad', command: 'mkdir -p /opt/app; rm -rf /' }] }
  : { notes: ['ai-reviewed'], artifacts: [{ path: 'deploy/AI.md', kind: 'markdown', content: 'safe' }] };
process.stdout.write(JSON.stringify({ result: JSON.stringify(payload) }));
`);
  const previousPath = process.env.PATH;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  try {
    process.env.PATH = `${fake.dir}:${previousPath ?? ''}`;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const plan = buildAssistPlan(dir);
    const generated = await generateAiAssistPlan(plan, 'claude');
    assert.equal(generated.generatedBy, 'ai');
    assert.equal(generated.notes.includes('ai-reviewed'), true);

    const dangerous = { ...plan, detection: { ...plan.detection, name: 'danger' } };
    await assert.rejects(() => generateAiAssistPlan(dangerous, 'claude'), /AI assist output rejected/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remote command validator rejects shell injection and destructive commands', () => {
  assert.equal(validateRemoteStep({ name: 'ok', command: 'mkdir -p /opt/app/release' }).ok, true);
  assert.equal(validateRemoteStep({ name: 'bad', command: 'mkdir -p /opt/app; rm -rf /' }).ok, false);
  assert.equal(validateRemoteStep({ name: 'bad', command: 'bash deploy.sh' }).ok, false);
});

test('executeRemotePlan defaults to dry-run and builds SSH commands without execution', () => {
  const dir = makeProject();
  try {
    const plan = buildAssistPlan(dir, { domain: 'app.example.com' });
    const result = executeRemotePlan(plan);

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(buildSshCommands(plan).length, plan.remoteSteps.length);
    assert.match(result.output, /ssh \$\{SSH_USER\}@\$\{SSH_HOST\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runHealthcheck uses curl without shell and reports status', () => {
  const fake = makeBin('curl', "process.stdout.write('ok');");
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${fake.dir}:${originalPath ?? ''}`;
    const result = runHealthcheck('http://localhost:3000/');

    assert.equal(result.ok, true);
    assert.equal(result.output, 'ok');
    assert.equal(runHealthcheck('file:///etc/passwd').ok, false);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fake.cleanup();
  }
});
