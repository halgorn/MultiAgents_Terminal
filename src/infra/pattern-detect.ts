import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { isIgnoredDirName } from './file-filter.js';
import { AI_RUNTIME_DIR, WORKTREES_DIR } from './paths.js';

export interface PatternSignal {
  pattern: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface AntiPattern {
  name: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  evidence: string[];
}

export interface PatternRecommendation {
  pattern: string;
  reason: string;
  fixes: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface PatternReport {
  detected: PatternSignal[];
  antiPatterns: AntiPattern[];
  recommendations: PatternRecommendation[];
  summary: string;
}

type DirSet = Set<string>;

function topDirs(cwd: string): DirSet {
  const dirs = new Set<string>();
  try {
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (entry.isDirectory() && !isIgnoredDirName(entry.name)) dirs.add(entry.name.toLowerCase());
    }
  } catch { /* ok */ }
  return dirs;
}

function hasDep(cwd: string, dep: string): boolean {
  for (const f of ['requirements.txt', 'requirements-dev.txt', 'Pipfile', 'pyproject.toml', 'package.json']) {
    try {
      if (readFileSync(join(cwd, f), 'utf8').toLowerCase().includes(dep.toLowerCase())) return true;
    } catch { /* ok */ }
  }
  return false;
}

function grepCount(cwd: string, pattern: string): number {
  const r = spawnSync('grep', [
    '-rn',
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=build',
    '--exclude-dir=out',
    '--exclude-dir=.next',
    '--exclude-dir=.nuxt',
    '--exclude-dir=.svelte-kit',
    '--exclude-dir=.turbo',
    '--exclude-dir=storybook-static',
    '--exclude=*.min.js',
    '--exclude=*.map',
    '--exclude=*.d.ts',
    '--exclude-dir=.git',
    `--exclude-dir=${AI_RUNTIME_DIR}`,
    `--exclude-dir=${WORKTREES_DIR}`,
    '--include=*.py',
    '--include=*.ts',
    '--include=*.js',
    '-l',
    pattern,
    '.',
  ], {
    cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  return r.stdout ? r.stdout.split('\n').filter(Boolean).length : 0;
}

function grepLines(cwd: string, pattern: string, ext = '*.py'): string[] {
  const r = spawnSync('grep', [
    '-rn',
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=build',
    '--exclude-dir=out',
    '--exclude-dir=.next',
    '--exclude-dir=.nuxt',
    '--exclude-dir=.svelte-kit',
    '--exclude-dir=.turbo',
    '--exclude-dir=storybook-static',
    '--exclude=*.min.js',
    '--exclude=*.map',
    '--exclude=*.d.ts',
    '--exclude-dir=.git',
    `--exclude-dir=${AI_RUNTIME_DIR}`,
    `--exclude-dir=${WORKTREES_DIR}`,
    `--include=${ext}`,
    pattern,
    '.',
  ], {
    cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
  return r.stdout ? r.stdout.split('\n').filter(Boolean).slice(0, 10) : [];
}

function detectArchPatterns(dirs: DirSet, cwd: string): PatternSignal[] {
  const signals: PatternSignal[] = [];

  // Agent-Based Architecture
  if (dirs.has('agents') || dirs.has('agent')) {
    const agentFiles = grepLines(cwd, 'class.*Agent', '*.py').length + grepLines(cwd, 'class.*Agent', '*.ts').length;
    signals.push({
      pattern: 'Agent-Based Architecture',
      category: 'IA',
      confidence: agentFiles > 5 ? 'high' : 'medium',
      evidence: [`agents/ or agent/ directory present`, `${agentFiles} Agent class definitions`],
    });
  }

  // RAG
  if (dirs.has('memory') || dirs.has('knowledge') || hasDep(cwd, 'langchain') || hasDep(cwd, 'llama') || hasDep(cwd, 'chromadb') || hasDep(cwd, 'pinecone')) {
    const retrieval = grepCount(cwd, 'retrieval\\|embedding\\|vector\\|rag');
    signals.push({
      pattern: 'RAG (Retrieval-Augmented Generation)',
      category: 'IA',
      confidence: retrieval > 2 ? 'high' : 'medium',
      evidence: [
        dirs.has('memory') ? 'memory/ directory' : '',
        retrieval > 0 ? `${retrieval} files with retrieval/embedding patterns` : '',
      ].filter(Boolean),
    });
  }

  // Client-Server
  if (hasDep(cwd, 'fastapi') || hasDep(cwd, 'flask') || hasDep(cwd, 'django') || hasDep(cwd, 'express') || dirs.has('api')) {
    const framework = hasDep(cwd, 'fastapi') ? 'FastAPI' : hasDep(cwd, 'flask') ? 'Flask' : hasDep(cwd, 'django') ? 'Django' : 'Express/other';
    signals.push({
      pattern: 'Client-Server',
      category: 'Rede',
      confidence: 'high',
      evidence: [`${framework} detected`, dirs.has('api') ? 'api/ directory' : ''],
    });
  }

  // Event-Driven
  const sse = grepCount(cwd, 'EventEmitter\\|event_bus\\|emit(\\|SSE\\|server.sent');
  const queue = hasDep(cwd, 'celery') || hasDep(cwd, 'kafka') || hasDep(cwd, 'rabbitmq') || hasDep(cwd, 'redis');
  if (sse > 2 || queue) {
    signals.push({
      pattern: 'Event-Driven Architecture',
      category: 'Distribuída',
      confidence: queue ? 'high' : 'medium',
      evidence: [
        sse > 0 ? `${sse} files with event/SSE patterns` : '',
        hasDep(cwd, 'celery') ? 'Celery (async tasks)' : '',
        hasDep(cwd, 'kafka') ? 'Kafka' : '',
        hasDep(cwd, 'redis') ? 'Redis (pub-sub candidate)' : '',
      ].filter(Boolean),
    });
  }

  // Pipeline Architecture
  const pipelines = grepCount(cwd, 'pipeline\\|Pipeline');
  if (pipelines > 3 || dirs.has('pipelines')) {
    signals.push({
      pattern: 'Pipeline Architecture',
      category: 'Processamento',
      confidence: pipelines > 5 ? 'high' : 'medium',
      evidence: [`${pipelines} files with pipeline patterns`],
    });
  }

  // Clean Architecture / Hexagonal
  const hasClean = ['domain', 'application', 'infrastructure', 'use_cases', 'usecases'].some((d) => dirs.has(d));
  const hasHex = ['ports', 'adapters'].some((d) => dirs.has(d));
  if (hasClean || hasHex) {
    signals.push({
      pattern: hasHex ? 'Hexagonal (Ports & Adapters)' : 'Clean Architecture',
      category: 'Arquitetura',
      confidence: 'high',
      evidence: ['domain/', 'application/', 'infrastructure/', 'ports/', 'adapters/'].filter((d) => dirs.has(d.replace('/', ''))),
    });
  }

  // Repository Pattern
  const repos = grepCount(cwd, 'class.*Repository\\|class.*Repo\\b');
  if (repos > 0) {
    signals.push({
      pattern: 'Repository Pattern',
      category: 'Design',
      confidence: repos > 3 ? 'high' : 'medium',
      evidence: [`${repos} Repository class definitions`],
    });
  }

  // DDD
  const hasDDD = ['aggregates', 'entities', 'value_objects', 'bounded_contexts'].some((d) => dirs.has(d));
  const dddPatterns = grepCount(cwd, 'AggregateRoot\\|ValueObject\\|DomainEvent\\|BoundedContext');
  if (hasDDD || dddPatterns > 2) {
    signals.push({
      pattern: 'DDD (Domain-Driven Design)',
      category: 'Modelagem',
      confidence: hasDDD ? 'high' : 'medium',
      evidence: [hasDDD ? 'DDD directories detected' : '', dddPatterns > 0 ? `${dddPatterns} DDD pattern classes` : ''].filter(Boolean),
    });
  }

  // Monolith (default if no microservices signals)
  const hasMultiCompose = existsSync(join(cwd, 'docker-compose.yml')) && !hasDep(cwd, 'microservice');
  if (!dirs.has('services') || hasMultiCompose) {
    signals.push({
      pattern: 'Monolithic Architecture',
      category: 'Arquitetura',
      confidence: 'high',
      evidence: ['Single deployable codebase', hasMultiCompose ? 'docker-compose.yml present' : ''].filter(Boolean),
    });
  }

  // MVVM Frontend
  if (dirs.has('frontend') || hasDep(cwd, 'react') || hasDep(cwd, 'vue') || hasDep(cwd, 'angular')) {
    const fw = hasDep(cwd, 'react') ? 'React' : hasDep(cwd, 'vue') ? 'Vue' : hasDep(cwd, 'angular') ? 'Angular' : 'unknown';
    signals.push({
      pattern: 'MVVM (frontend)',
      category: 'Interface',
      confidence: 'medium',
      evidence: [`${fw} frontend framework`],
    });
  }

  // Agentic Workflow
  if (hasDep(cwd, 'openai') || hasDep(cwd, 'anthropic') || hasDep(cwd, 'langchain')) {
    signals.push({
      pattern: 'Agentic Workflow',
      category: 'IA',
      confidence: 'high',
      evidence: [
        hasDep(cwd, 'openai') ? 'OpenAI SDK' : '',
        hasDep(cwd, 'anthropic') ? 'Anthropic SDK' : '',
        hasDep(cwd, 'langchain') ? 'LangChain' : '',
      ].filter(Boolean),
    });
  }

  return signals;
}

function detectAntiPatterns(cwd: string, hotspots?: Array<{ file: string; fanIn: number; fanOut: number }>): AntiPattern[] {
  const anti: AntiPattern[] = [];

  // God Object from hotspots
  const gods = (hotspots ?? []).filter((h) => h.fanOut >= 30);
  if (gods.length > 0) {
    anti.push({
      name: 'God Object / God Module',
      severity: 'high',
      description: 'Modules with excessive outgoing dependencies concentrate too much responsibility',
      evidence: gods.map((h) => `${h.file} (${h.fanOut} outgoing imports)`),
    });
  }

  // Scattered Data Access (SQL not in repository files)
  const sqlInNonRepo = grepLines(cwd, 'execute.*SELECT\\|cursor\\.execute\\|db\\.execute', '*.py')
    .filter((l) => !l.includes('repository') && !l.includes('repo') && !l.includes('_db.py'));
  if (sqlInNonRepo.length > 5) {
    anti.push({
      name: 'Scattered Data Access',
      severity: 'critical',
      description: 'SQL queries outside of repository/data-access layer violates separation of concerns',
      evidence: sqlInNonRepo.slice(0, 5),
    });
  }

  // Missing Repository Pattern with raw SQL
  const rawSql = grepCount(cwd, 'execute.*SELECT\\|cursor\\.execute');
  const repoClasses = grepCount(cwd, 'class.*Repository\\|class.*Repo\\b');
  if (rawSql > 10 && repoClasses === 0) {
    anti.push({
      name: 'Missing Repository Abstraction',
      severity: 'high',
      description: 'Raw SQL scattered across codebase without data access layer',
      evidence: [`${rawSql} raw SQL execute() calls`, 'No Repository classes detected'],
    });
  }

  return anti;
}

function buildRecommendations(detected: PatternSignal[], anti: AntiPattern[]): PatternRecommendation[] {
  const recs: PatternRecommendation[] = [];
  const detectedNames = new Set(detected.map((d) => d.pattern));

  if (anti.some((a) => a.name === 'Missing Repository Abstraction' || a.name === 'Scattered Data Access')) {
    recs.push({
      pattern: 'Repository Pattern',
      reason: 'Raw SQL scattered across codebase. Repository Pattern centralizes data access, enables parameterized queries, and makes testing possible.',
      fixes: ['Create a repositories/ directory', 'Move all execute() calls into Repository classes', 'Inject repositories via constructors'],
      priority: 'high',
    });
  }

  if (detectedNames.has('Monolithic Architecture') && !detectedNames.has('Clean Architecture') && !detectedNames.has('Hexagonal (Ports & Adapters)')) {
    recs.push({
      pattern: 'Modular Monolith + Clean Architecture',
      reason: 'Monolith without clear layer separation leads to coupling and testability issues.',
      fixes: ['Define explicit module boundaries (agents, api, memory)', 'Add interfaces between modules', 'Separate business logic from framework code'],
      priority: 'medium',
    });
  }

  if (detectedNames.has('Agent-Based Architecture') && !detectedNames.has('DDD (Domain-Driven Design)')) {
    recs.push({
      pattern: 'DDD Bounded Contexts',
      reason: 'Agent systems benefit from explicit domain boundaries to prevent coupling between agent types.',
      fixes: ['Define bounded contexts per agent type', 'Create explicit contracts between agent domains', 'Separate agent orchestration from agent execution'],
      priority: 'medium',
    });
  }

  if (anti.some((a) => a.name === 'God Object / God Module')) {
    recs.push({
      pattern: 'Single Responsibility + Dependency Inversion',
      reason: 'God modules create fragility — every change risks cascading failures.',
      fixes: ['Extract sub-responsibilities into dedicated modules', 'Use dependency injection to invert control', 'Apply Interface Segregation to split large interfaces'],
      priority: 'high',
    });
  }

  return recs;
}

export function detectPatterns(cwd: string, hotspots?: Array<{ file: string; fanIn: number; fanOut: number }>): PatternReport {
  const dirs = topDirs(cwd);
  const detected = detectArchPatterns(dirs, cwd);
  const antiPatterns = detectAntiPatterns(cwd, hotspots);
  const recommendations = buildRecommendations(detected, antiPatterns);

  const summary = [
    `Detected ${detected.length} architectural patterns.`,
    antiPatterns.length > 0 ? `${antiPatterns.length} anti-patterns identified.` : 'No major anti-patterns detected.',
    recommendations.length > 0 ? `${recommendations.length} improvements recommended.` : '',
  ].filter(Boolean).join(' ');

  return { detected, antiPatterns, recommendations, summary };
}
