import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_REGISTRY } from '../agents/index.js';
import { FLOW_REGISTRY } from '../core/pipelines/index.js';
import { ToolRegistry } from '../infra/tool-registry.js';
import { ZOD_SCHEMA_REGISTRY, KNOWN_OUTPUT_SCHEMAS } from './registry.js';

test('AGENT_REGISTRY: all manifests have required fields', () => {
  for (const m of AGENT_REGISTRY) {
    assert.ok(m.name.length > 0, `agent manifest missing name`);
    assert.ok(m.description.length > 0, `agent ${m.name}: missing description`);
    assert.ok(m.outputSchema.length > 0, `agent ${m.name}: missing outputSchema`);
    assert.ok(
      ['context-reduction', 'none'].includes(m.retryStrategy),
      `agent ${m.name}: invalid retryStrategy "${m.retryStrategy}"`,
    );
    assert.equal(typeof m.requiresWorktree, 'boolean', `agent ${m.name}: requiresWorktree must be boolean`);
    assert.ok(
      ['throw', 'fallback'].includes(m.failureBehavior),
      `agent ${m.name}: invalid failureBehavior "${m.failureBehavior}"`,
    );
  }
});

test('AGENT_REGISTRY: agent names are unique', () => {
  const names = AGENT_REGISTRY.map((m) => m.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, `duplicate agent names: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

test('FLOW_REGISTRY: all agent names resolve in AGENT_REGISTRY', () => {
  const agentNames = new Set(AGENT_REGISTRY.map((m) => m.name));
  for (const flow of FLOW_REGISTRY) {
    for (const agentName of flow.agentSequence) {
      assert.ok(
        agentNames.has(agentName),
        `flow "${flow.name}" references unknown agent "${agentName}"`,
      );
    }
  }
});

test('FLOW_REGISTRY: all manifests have required fields', () => {
  for (const f of FLOW_REGISTRY) {
    assert.ok(f.name.length > 0, `flow manifest missing name`);
    assert.ok(f.description.length > 0, `flow ${f.name}: missing description`);
    assert.ok(f.inputDescription.length > 0, `flow ${f.name}: missing inputDescription`);
    assert.ok(f.outputSchema.length > 0, `flow ${f.name}: missing outputSchema`);
    assert.ok(f.agentSequence.length > 0, `flow ${f.name}: agentSequence must not be empty`);
    assert.ok(
      ['abort', 'skip-and-continue', 'fallback'].includes(f.failureStrategy),
      `flow ${f.name}: invalid failureStrategy "${f.failureStrategy}"`,
    );
  }
});

test('FLOW_REGISTRY: flow names are unique', () => {
  const names = FLOW_REGISTRY.map((f) => f.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, `duplicate flow names: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

test('ToolRegistry: all tools have name, description, and inputSchema', () => {
  for (const tool of ToolRegistry) {
    assert.ok(tool.name.length > 0, `tool missing name`);
    assert.ok(tool.description.length > 0, `tool ${tool.name}: missing description`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `tool ${tool.name}: missing inputSchema`);
  }
});

test('ToolRegistry: tool names are unique', () => {
  const names = ToolRegistry.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, `duplicate tool names: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

// ── SchemaRegistry: contract governance ──────────────────────────────────────

test('ZOD_SCHEMA_REGISTRY: all entries are valid Zod schemas', () => {
  for (const [name, schema] of Object.entries(ZOD_SCHEMA_REGISTRY)) {
    assert.ok(
      typeof (schema as { parse?: unknown }).parse === 'function',
      `ZOD_SCHEMA_REGISTRY["${name}"] is missing .parse — not a Zod schema`,
    );
  }
});

test('AGENT_REGISTRY: all outputSchema strings are in KNOWN_OUTPUT_SCHEMAS', () => {
  for (const m of AGENT_REGISTRY) {
    assert.ok(
      KNOWN_OUTPUT_SCHEMAS.has(m.outputSchema),
      `agent "${m.name}": outputSchema "${m.outputSchema}" not in KNOWN_OUTPUT_SCHEMAS`,
    );
  }
});

test('FLOW_REGISTRY: all outputSchema strings are in KNOWN_OUTPUT_SCHEMAS', () => {
  for (const f of FLOW_REGISTRY) {
    assert.ok(
      KNOWN_OUTPUT_SCHEMAS.has(f.outputSchema),
      `flow "${f.name}": outputSchema "${f.outputSchema}" not in KNOWN_OUTPUT_SCHEMAS`,
    );
  }
});

test('ZOD_SCHEMA_REGISTRY: key count matches number of unique Zod-backed outputSchemas', () => {
  const zodBacked = new Set(
    [...AGENT_REGISTRY, ...FLOW_REGISTRY]
      .map((m) => m.outputSchema)
      .filter((s) => ZOD_SCHEMA_REGISTRY[s] !== undefined),
  );
  for (const name of zodBacked) {
    assert.ok(
      ZOD_SCHEMA_REGISTRY[name] !== undefined,
      `outputSchema "${name}" used in manifests but missing from ZOD_SCHEMA_REGISTRY`,
    );
  }
});
