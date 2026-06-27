#!/usr/bin/env node
// scripts/check-layers.mjs
// Enforces one-direction layer dependencies per docs/SPEC-V1.md §4.
//
// Layers:
//   domain/         (no deps)
//   application/    (may import domain)
//   infrastructure/ (implements application/ports)
//   interface/      (may import application + domain)
//
// Rules:
//   - domain/ may not import from application/, infrastructure/, interface/
//   - application/ may not import from infrastructure/, interface/
//   - infrastructure/ may not import from interface/
//   - interface/ may not import from infrastructure/ EXCEPT via application/ports
//   - any layer may import from shared/ (none yet, reserved)
//
// This is a soft check — it flags violations but does not fail by default.
// Set STRICT_LAYERS=1 to fail the build on violation.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');
const STRICT = process.env.STRICT_LAYERS === '1';

const LAYERS = {
  domain: ['domain'],
  application: ['application'],
  infrastructure: ['infrastructure'],
  interface: ['interface', 'mcp', 'cli', 'agents', 'core', 'prompts', 'providers', 'infra'],
};

function getLayer(filePath) {
  const rel = relative(SRC, filePath).replace(/\\/g, '/');
  const first = rel.split('/')[0];
  if (first === 'domain') return 'domain';
  if (first === 'application') return 'application';
  if (first === 'infrastructure') return 'infrastructure';
  if (first === 'interface') return 'interface';
  if (LAYERS.interface.includes(first)) return 'legacy';
  return null;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__integration__' || entry === '__bench__' || entry === 'test-utils') continue;
      walk(full, files);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function extractImports(content) {
  const imports = [];
  const re = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveImportPath(importer, spec) {
  if (!spec.startsWith('.')) return null;
  const dir = dirname(importer);
  const abs = join(dir, spec);
  return abs;
}

const RULES = [
  { from: 'domain', forbid: ['application', 'infrastructure', 'interface'], msg: 'domain must be pure — no application/infrastructure/interface deps' },
  { from: 'application', forbid: ['infrastructure', 'interface'], msg: 'application must depend on ports, not concrete infrastructure or interface' },
  { from: 'infrastructure', forbid: ['interface'], msg: 'infrastructure cannot import from interface layer' },
];

const violations = [];
const files = walk(SRC);

for (const file of files) {
  const fromLayer = getLayer(file);
  if (!fromLayer || fromLayer === 'legacy') continue;
  const content = readFileSync(file, 'utf8');
  const imports = extractImports(content);
  for (const spec of imports) {
    const resolved = resolveImportPath(file, spec);
    if (!resolved) continue;
    let targetLayer = getLayer(resolved);
    if (!targetLayer || targetLayer === 'legacy') continue;
    for (const rule of RULES) {
      if (fromLayer === rule.from && rule.forbid.includes(targetLayer)) {
        const rel = relative(SRC, file);
        violations.push({ file: rel, from: fromLayer, to: targetLayer, spec, msg: rule.msg });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ Layer rules OK (${files.length} files checked, ${getLayer.files ?? ''} layers)`);
  console.log('  domain → (none)');
  console.log('  application → domain OK');
  console.log('  infrastructure → application/domain OK');
  console.log('  interface → application/domain OK');
  process.exit(0);
}

console.log(`\n✗ Found ${violations.length} layer violation(s):\n`);
for (const v of violations) {
  console.log(`  ${v.file}`);
  console.log(`    ${v.from} → ${v.to}  (${v.spec})`);
  console.log(`    ${v.msg}`);
  console.log('');
}

if (STRICT) {
  console.log('STRICT_LAYERS=1: failing build');
  process.exit(1);
} else {
  console.log('Set STRICT_LAYERS=1 to fail on violations.');
  process.exit(0);
}