import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_REGISTRY } from '../agents/index.js';
import { FLOW_REGISTRY } from '../core/pipelines/index.js';
import { ToolRegistry } from '../infra/tool-registry.js';

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
