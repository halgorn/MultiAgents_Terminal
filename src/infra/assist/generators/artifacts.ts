import type { AssistArtifact, AssistPlan, ProjectDetection } from '../types.js';

function installCommand(detection: ProjectDetection): string {
  if (detection.packageManager === 'pnpm') return 'pnpm install --frozen-lockfile';
  if (detection.packageManager === 'yarn') return 'yarn install --frozen-lockfile';
  if (detection.packageManager === 'bun') return 'bun install --frozen-lockfile';
  return 'npm ci';
}

export function generateCiWorkflow(plan: AssistPlan): string {
  const checks = [
    plan.detection.buildCommand,
    plan.detection.testCommand,
    plan.detection.lintCommand,
  ].filter(Boolean);
  const checkBlock = checks.map((command, index) => [
    `      - name: ${index === 0 ? 'Build' : index === 1 ? 'Test' : 'Lint'}`,
    `        run: ${command}`,
  ].join('\n')).join('\n\n');

  return `name: Aion CI

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [18, 20, 22]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: ${plan.detection.packageManager === 'unknown' ? 'npm' : plan.detection.packageManager}
      - name: Install
        run: ${installCommand(plan.detection)}

${checkBlock || '      - name: Smoke\n        run: echo "No build/test scripts detected"'}

      - name: Aion local scans
        env:
          AION_SKIP_UPDATE_CHECK: "1"
          ANTHROPIC_API_KEY: ""
          OPENROUTER_API_KEY: ""
          OPENAI_API_KEY: ""
          VOYAGE_API_KEY: ""
          QDRANT_URL: ""
        run: |
          npx aion scan secrets
          npx aion scan env-audit
          npx aion scan sbom --unpinned-only
          npx aion audit . --dry-run --max-files 20
`;
}

export function generateDeployWorkflow(plan: AssistPlan): string {
  const remoteStart = plan.detection.hasCompose
    ? `docker compose -f ${plan.target.deployPath}/release/docker-compose.yml up -d --build`
    : `${plan.detection.packageManager === 'pnpm' ? 'pnpm' : plan.detection.packageManager === 'yarn' ? 'yarn' : plan.detection.packageManager === 'bun' ? 'bun' : 'npm'} --prefix ${plan.target.deployPath}/release start`;
  return `name: Aion Deploy

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    needs: []
    environment: production

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: ${plan.detection.packageManager === 'unknown' ? 'npm' : plan.detection.packageManager}
      - name: Install
        run: ${installCommand(plan.detection)}
      - name: Build
        run: ${plan.detection.buildCommand || 'echo "No build script detected"'}
      - name: Test
        run: ${plan.detection.testCommand || 'echo "No test script detected"'}
      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          printf '%s' "\${{ secrets.${plan.target.sshKeySecret} }}" > ~/.ssh/aion_deploy_key
          chmod 600 ~/.ssh/aion_deploy_key
      - name: Upload release
        run: |
          rsync -az --delete -e "ssh -i ~/.ssh/aion_deploy_key -o StrictHostKeyChecking=no" ./ "\${{ secrets.${plan.target.sshUserSecret} }}@\${{ secrets.${plan.target.sshHostSecret} }}:${plan.target.deployPath}/release/"
      - name: Remote deploy
        run: |
          ssh -i ~/.ssh/aion_deploy_key -o StrictHostKeyChecking=no "\${{ secrets.${plan.target.sshUserSecret} }}@\${{ secrets.${plan.target.sshHostSecret} }}" "${remoteStart}"
      - name: Healthcheck
        run: curl --fail --silent --show-error --max-time 20 "${plan.healthcheckUrl}"
`;
}

export function generateNginxConfig(plan: AssistPlan): string {
  return `server {
    listen 80;
    server_name ${plan.target.domain};

    location / {
        proxy_pass http://127.0.0.1:${plan.target.appPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

export function generateHealthcheckScript(plan: AssistPlan): string {
  return `#!/usr/bin/env sh
set -eu
curl --fail --silent --show-error --max-time 20 "${plan.healthcheckUrl}"
`;
}

export function generateRollbackScript(plan: AssistPlan): string {
  const restart = plan.detection.hasCompose
    ? `docker compose -f "${plan.target.deployPath}/previous/docker-compose.yml" up -d --build`
    : `${plan.detection.packageManager === 'pnpm' ? 'pnpm' : plan.detection.packageManager === 'yarn' ? 'yarn' : plan.detection.packageManager === 'bun' ? 'bun' : 'npm'} --prefix "${plan.target.deployPath}/previous" start`;
  return `#!/usr/bin/env sh
set -eu
if [ ! -d "${plan.target.deployPath}/previous" ]; then
  echo "No previous release found."
  exit 1
fi
${restart}
`;
}

export function generateDeployReadme(plan: AssistPlan): string {
  return `# Aion Assisted Deploy

Generated by Aion for ${plan.detection.name}.

## Required GitHub Secrets
${plan.requiredSecrets.map((secret) => `- \`${secret}\``).join('\n')}

## Healthcheck
- ${plan.healthcheckUrl}

## Local Checks
${plan.localChecks.map((check) => `- \`${check}\``).join('\n')}

## Remote Steps
${plan.remoteSteps.map((step) => `- ${step.name}: \`${step.command}\``).join('\n')}
`;
}

export function generateArtifacts(plan: AssistPlan): AssistArtifact[] {
  return [
    { path: '.github/workflows/aion-ci.yml', kind: 'github-actions', content: generateCiWorkflow(plan) },
    { path: '.github/workflows/aion-deploy.yml', kind: 'github-actions', content: generateDeployWorkflow(plan) },
    { path: 'deploy/nginx/aion-app.conf', kind: 'nginx', content: generateNginxConfig(plan) },
    { path: 'deploy/scripts/healthcheck.sh', kind: 'script', executable: true, content: generateHealthcheckScript(plan) },
    { path: 'deploy/scripts/rollback.sh', kind: 'script', executable: true, content: generateRollbackScript(plan) },
    { path: '.ai-runtime/assist/README.md', kind: 'markdown', content: generateDeployReadme(plan) },
  ];
}
