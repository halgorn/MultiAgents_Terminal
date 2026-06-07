import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AionConfig } from '../aion-config.js';

const SETUP_STATE_VERSION = 1;

export interface SetupProgress {
  configReady: boolean;
  localIndexReady: boolean;
  dependencyMapReady: boolean;
  semanticRagReady: boolean;
}

export interface SetupState {
  version: number;
  preparedAt: string;
  cwd: string;
  progress: SetupProgress;
  selectedDomain: string;
  selectedBudget: 'low' | 'normal' | 'deep';
  selectedScanners: number;
  skippedSemanticRag: boolean;
}

function statePath(cwd: string): string {
  return join(cwd, '.ai-runtime', 'setup-state.json');
}

export function readSetupState(cwd: string): SetupState | null {
  try {
    const path = statePath(cwd);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SetupState;
    if (raw.version !== SETUP_STATE_VERSION) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeSetupState(cwd: string, state: SetupState): string {
  const path = statePath(cwd);
  mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return path;
}

export function isProjectPrepared(cwd: string): boolean {
  const state = readSetupState(cwd);
  if (!state) return false;
  return state.progress.configReady && state.progress.localIndexReady && state.progress.dependencyMapReady;
}

export function clearSetupState(cwd: string): void {
  rmSync(statePath(cwd), { force: true });
}

export function createSetupState(cwd: string, input: {
  progress: SetupProgress;
  selectedDomain: string;
  selectedBudget: 'low' | 'normal' | 'deep';
  selectedScanners: number;
  skippedSemanticRag: boolean;
}): SetupState {
  return {
    version: SETUP_STATE_VERSION,
    preparedAt: new Date().toISOString(),
    cwd,
    progress: input.progress,
    selectedDomain: input.selectedDomain,
    selectedBudget: input.selectedBudget,
    selectedScanners: input.selectedScanners,
    skippedSemanticRag: input.skippedSemanticRag,
  };
}

export function shouldRunInitialWizard(cwd: string, isTty: boolean): boolean {
  if (!isTty) return false;
  return !isProjectPrepared(cwd);
}

export function mergeSetupDefaultsIntoConfig(existing: AionConfig, input: {
  domain: string;
  budget: 'low' | 'normal' | 'deep';
  scanners: number;
}): AionConfig {
  const result: AionConfig = { ...existing };
  if (!result.preset && !result.domains?.length) result.domains = [input.domain];
  if (!result.budget) result.budget = input.budget;
  if (!result.scanners) result.scanners = input.scanners;
  if (!result.provider) result.provider = 'claude';
  return result;
}
