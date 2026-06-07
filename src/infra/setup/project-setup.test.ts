import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  clearSetupState,
  createSetupState,
  detectRagTrainingStatus,
  hasTrainedProjectRag,
  isProjectPrepared,
  mergeSetupDefaultsIntoConfig,
  readSetupState,
  shouldRunInitialWizard,
  writeSetupState,
} from './project-setup.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'aion-setup-state-'));
}

test('setup state marks project as prepared when required steps are complete', () => {
  const dir = tempProject();
  try {
    const state = createSetupState(dir, {
      progress: {
        configReady: true,
        localIndexReady: true,
        dependencyMapReady: true,
        semanticRagReady: false,
      },
      selectedDomain: 'bugs',
      selectedBudget: 'low',
      selectedScanners: 1,
      skippedSemanticRag: true,
    });
    writeSetupState(dir, state);
    assert.equal(isProjectPrepared(dir), true);
    assert.equal(readSetupState(dir)?.selectedDomain, 'bugs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup state reset clears prepared marker', () => {
  const dir = tempProject();
  try {
    const state = createSetupState(dir, {
      progress: {
        configReady: true,
        localIndexReady: true,
        dependencyMapReady: true,
        semanticRagReady: true,
      },
      selectedDomain: 'security',
      selectedBudget: 'normal',
      selectedScanners: 2,
      skippedSemanticRag: false,
    });
    writeSetupState(dir, state);
    assert.equal(isProjectPrepared(dir), true);
    clearSetupState(dir);
    assert.equal(isProjectPrepared(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initial wizard only runs in tty and when project is not prepared', () => {
  const dir = tempProject();
  try {
    assert.equal(shouldRunInitialWizard(dir, false), false);
    assert.equal(shouldRunInitialWizard(dir, true), true);
    writeSetupState(dir, createSetupState(dir, {
      progress: {
        configReady: true,
        localIndexReady: true,
        dependencyMapReady: true,
        semanticRagReady: false,
      },
      selectedDomain: 'bugs',
      selectedBudget: 'low',
      selectedScanners: 1,
      skippedSemanticRag: true,
    }));
    assert.equal(shouldRunInitialWizard(dir, true), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup defaults merge without overriding existing user config', () => {
  const merged = mergeSetupDefaultsIntoConfig(
    { provider: 'openrouter', scanners: 2, domains: ['security'] },
    { domain: 'bugs', budget: 'low', scanners: 1 },
  );
  assert.deepEqual(merged.domains, ['security']);
  assert.equal(merged.provider, 'openrouter');
  assert.equal(merged.budget, 'low');
  assert.equal(merged.scanners, 2);
});

test('detectRagTrainingStatus identifies trained rag artifacts', () => {
  const dir = tempProject();
  try {
    mkdirSync(join(dir, '.ai-runtime'), { recursive: true });
    mkdirSync(join(dir, '.ai-memory', 'architecture'), { recursive: true });
    writeFileSync(join(dir, '.ai-runtime', 'repo-index.json'), '{"ok":true}');
    writeFileSync(join(dir, '.ai-runtime', 'vectors.json'), '[{"id":"a"}]');
    writeFileSync(join(dir, '.ai-memory', 'architecture', 'dep-graph.md'), '# dep graph');

    const status = detectRagTrainingStatus(dir);
    assert.equal(status.repoIndexReady, true);
    assert.equal(status.semanticVectorsReady, true);
    assert.equal(status.dependencyKnowledgeReady, true);
    assert.equal(hasTrainedProjectRag(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
