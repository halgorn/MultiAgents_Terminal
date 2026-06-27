import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { PilManifest } from './manifest.js';
import { PilManifestSchema } from './manifest.js';

export interface SchemaMigrator {
  canHandle(version: number): boolean;
  migrate(dataDir: string): Promise<{ manifest: PilManifest; dataDir: string }>;
}

const MIGRATION_MARKER = '.migrated.v';

export function isMigrated(dataDir: string, targetVersion: number): boolean {
  const marker = join(dataDir, `${MIGRATION_MARKER}${targetVersion}`);
  return existsSync(marker);
}

export function markMigrated(dataDir: string, targetVersion: number): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, `${MIGRATION_MARKER}${targetVersion}`), new Date().toISOString(), 'utf8');
}

export class V1ToV2Migrator implements SchemaMigrator {
  canHandle(version: number): boolean {
    return version === 1;
  }

  async migrate(dataDir: string): Promise<{ manifest: PilManifest; dataDir: string }> {
    const v1ManifestPath = join(dataDir, 'project.json');
    if (!existsSync(v1ManifestPath)) {
      throw new Error(`V1ToV2Migrator: no project.json at ${v1ManifestPath}`);
    }
    const raw = JSON.parse(readFileSync(v1ManifestPath, 'utf8')) as Record<string, unknown>;
    const embeddings = (raw['embeddings'] ?? {}) as Record<string, unknown>;
    const dim = typeof embeddings['dim'] === 'number' ? embeddings['dim'] : 384;
    const providerId = typeof embeddings['provider'] === 'string' ? embeddings['provider'] : 'unknown';
    const modelId = typeof embeddings['model'] === 'string' ? embeddings['model'] : 'unknown';
    const vectorsPath = typeof embeddings['vectorsPath'] === 'string' ? embeddings['vectorsPath'] : 'project.vectors.bin';

    const manifest: PilManifest = PilManifestSchema.parse({
      schemaVersion: 2,
      generatedAt: typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : new Date().toISOString(),
      root: typeof raw['root'] === 'string' ? raw['root'] : dataDir,
      repoHash: typeof raw['repoHash'] === 'string' ? raw['repoHash'] : 'unknown',
      fileCount: typeof raw['stats'] === 'object' && raw['stats'] && typeof (raw['stats'] as Record<string, unknown>)['files'] === 'number'
        ? (raw['stats'] as Record<string, number>)['files']!
        : 0,
      chunkCount: Array.isArray(raw['chunks']) ? raw['chunks'].length : 0,
      embeddings: {
        providerId,
        modelId,
        dim,
        indexType: 'flat',
        vectorsPath,
        count: Array.isArray(raw['chunks']) ? raw['chunks'].length : 0,
        norm: 'l2',
      },
    });

    return { manifest, dataDir };
  }
}

export class V0ToV1Migrator implements SchemaMigrator {
  canHandle(version: number): boolean {
    return version === 0;
  }

  async migrate(dataDir: string): Promise<{ manifest: PilManifest; dataDir: string }> {
    const repoIndexPath = join(dataDir, 'repo-index.json');
    if (!existsSync(repoIndexPath)) {
      throw new Error(`V0ToV1Migrator: no repo-index.json at ${repoIndexPath}`);
    }
    const raw = JSON.parse(readFileSync(repoIndexPath, 'utf8')) as Record<string, unknown>;
    const files = Array.isArray(raw['files']) ? raw['files'] : [];

    const v1: Record<string, unknown> = {
      schemaVersion: 1,
      generatedAt: typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : new Date().toISOString(),
      root: typeof raw['root'] === 'string' ? raw['root'] : dataDir,
      repoHash: typeof raw['repoHash'] === 'string' ? raw['repoHash'] : 'unknown',
      files,
      symbols: Array.isArray(raw['symbols']) ? raw['symbols'] : [],
      imports: Array.isArray(raw['imports']) ? raw['imports'] : [],
      chunks: Array.isArray(raw['chunks']) ? raw['chunks'] : [],
      tests: Array.isArray(raw['tests']) ? raw['tests'] : [],
      stats: {
        files: files.length,
        symbols: 0,
        imports: 0,
        chunks: 0,
        testLinks: 0,
      },
      embeddings: {
        provider: 'hash-fallback',
        model: 'hash-384',
        dim: 384,
        vectorsPath: 'project.vectors.bin',
        count: 0,
      },
      deps: { nodes: [], edges: [], cycles: [], hotspots: [] },
    };

    const v1Path = join(dataDir, 'project.json');
    writeFileSync(v1Path, JSON.stringify(v1, null, 2), 'utf8');
    renameSync(v1Path, v1Path);

    return new V1ToV2Migrator().migrate(dataDir);
  }
}

export class MigrationChain {
  private readonly migrators: SchemaMigrator[];

  constructor(migrators: SchemaMigrator[] = [new V0ToV1Migrator(), new V1ToV2Migrator()]) {
    this.migrators = migrators;
  }

  async runToLatest(dataDir: string): Promise<PilManifest> {
    let currentVersion = await this.detectVersion(dataDir);
    if (currentVersion === 2) {
      return this.readV2Manifest(dataDir);
    }
    let manifest: PilManifest | null = null;
    for (const migrator of this.migrators) {
      if (migrator.canHandle(currentVersion)) {
        const result = await migrator.migrate(dataDir);
        manifest = result.manifest;
        markMigrated(dataDir, currentVersion + 1);
        currentVersion++;
        if (currentVersion === 2) break;
      }
    }
    if (!manifest) {
      throw new Error(`MigrationChain: no migrator for version ${currentVersion}`);
    }
    return manifest;
  }

  private readV2Manifest(dataDir: string): PilManifest {
    const path = join(dataDir, 'pil', 'manifest.json');
    if (!existsSync(path)) {
      throw new Error(`MigrationChain: claimed v2 but no manifest at ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return PilManifestSchema.parse(raw);
  }

  private async detectVersion(dataDir: string): Promise<number> {
    const v2Path = join(dataDir, 'pil', 'manifest.json');
    if (existsSync(v2Path)) {
      const raw = JSON.parse(readFileSync(v2Path, 'utf8')) as { schemaVersion?: number };
      return raw.schemaVersion ?? 2;
    }
    const v1Path = join(dataDir, 'project.json');
    if (existsSync(v1Path)) {
      const raw = JSON.parse(readFileSync(v1Path, 'utf8')) as { schemaVersion?: number };
      return raw.schemaVersion ?? 1;
    }
    const v0Path = join(dataDir, 'repo-index.json');
    if (existsSync(v0Path)) {
      return 0;
    }
    throw new Error(`MigrationChain: no PIL/legacy index at ${dataDir}`);
  }
}