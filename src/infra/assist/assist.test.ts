import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir, platform } from 'os';
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
  if (platform() === 'win32') {
    // spawn() has no shell here, so the fake bin must be something Windows'
    // PATHEXT resolution can find and run directly: a .cmd shim delegating to node.
    writeFileSync(join(dir, `${name}.js`), body, 'utf8');
    writeFileSync(join(dir, `${name}.cmd`), `@node "%~dp0${name}.js" %*\n`, 'utf8');
  } else {
    const file = join(dir, name);
    writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, 'utf8');
    chmodSync(file, 0o755);
  }
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

// On win32, Node refuses to spawn .cmd/.bat files without shell:true (hardened after
// CVE-2024-27980), so this fake claude.cmd shim can never be resolved by cli-provider.ts's
// shell:false spawn() call — the real installed claude.exe gets invoked instead, making a
// live AI call. Production code correctly avoids shell:true (prompts are untrusted content),
// and CI only runs ubuntu-latest, so this is a Windows-local-dev test-infra gap, not an aion bug.
test('generateAiAssistPlan accepts safe Claude CLI JSON and rejects dangerous commands', { skip: platform() === 'win32' ? 'fake claude.cmd cannot be spawned without shell:true on Windows (Node CVE-2024-27980 hardening); CI runs Linux only' : false }, async () => {
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
    process.env.PATH = `${fake.dir}${delimiter}${previousPath ?? ''}`;
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
    // The spawned "claude" child briefly holds its cwd open on Windows even after exit;
    // retry so a transient EPERM/EBUSY doesn't fail the test.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

test('executeRemotePlan fails clearly when SSH env vars are missing', () => {
  const dir = makeProject();
  try {
    const plan = buildAssistPlan(dir, { domain: 'app.example.com' });
    const saved = { user: process.env['SSH_USER'], host: process.env['SSH_HOST'] };
    delete process.env['SSH_USER'];
    delete process.env['SSH_HOST'];
    try {
      const result = executeRemotePlan(plan, { dryRun: false, yes: true });
      assert.equal(result.ok, false);
      assert.match(result.output, /SSH_USER.*not set|SSH_HOST.*not set/);
    } finally {
      if (saved.user !== undefined) process.env['SSH_USER'] = saved.user;
      if (saved.host !== undefined) process.env['SSH_HOST'] = saved.host;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Same win32 .cmd-without-shell limitation as the claude fake above (remote-executor.ts
// correctly avoids shell:true for ssh args), so the fake ssh.cmd is unreachable here.
test('executeRemotePlan resolves SSH target from env in non-dry-run mode', { skip: platform() === 'win32' ? 'fake ssh.cmd cannot be spawned without shell:true on Windows (Node CVE-2024-27980 hardening); CI runs Linux only' : false }, () => {
  const dir = makeProject();
  const fake = makeBin('ssh', "process.stdout.write(process.argv.slice(2).join(' '));");
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  const saved = { user: process.env['SSH_USER'], host: process.env['SSH_HOST'] };
  try {
    process.env.PATH = `${fake.dir}${delimiter}${originalPath ?? ''}`;
    // Windows resolves bare commands extension-by-extension across the whole PATH, so a
    // real ssh.exe elsewhere on PATH would win over our fake ssh.cmd unless .CMD is tried first.
    if (platform() === 'win32') process.env.PATHEXT = `.CMD;${originalPathExt ?? ''}`;
    process.env['SSH_USER'] = 'deploy';
    process.env['SSH_HOST'] = 'example.com';
    const plan = buildAssistPlan(dir, { domain: 'example.com' });
    const result = executeRemotePlan(plan, { dryRun: false, yes: true });
    assert.equal(result.dryRun, false);
    assert.match(result.output, /deploy@example\.com/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
    if (saved.user === undefined) delete process.env['SSH_USER'];
    else process.env['SSH_USER'] = saved.user;
    if (saved.host === undefined) delete process.env['SSH_HOST'];
    else process.env['SSH_HOST'] = saved.host;
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Same win32 .cmd-without-shell limitation as above (curl fake is unreachable without shell:true).
test('runHealthcheck uses curl without shell and reports status', { skip: platform() === 'win32' ? 'fake curl.cmd cannot be spawned without shell:true on Windows (Node CVE-2024-27980 hardening); CI runs Linux only' : false }, () => {
  const fake = makeBin('curl', "process.stdout.write('ok');");
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  try {
    process.env.PATH = `${fake.dir}${delimiter}${originalPath ?? ''}`;
    if (platform() === 'win32') process.env.PATHEXT = `.CMD;${originalPathExt ?? ''}`;
    const result = runHealthcheck('http://localhost:3000/');

    assert.equal(result.ok, true);
    assert.equal(result.output, 'ok');
    assert.equal(runHealthcheck('file:///etc/passwd').ok, false);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
    fake.cleanup();
  }
});
