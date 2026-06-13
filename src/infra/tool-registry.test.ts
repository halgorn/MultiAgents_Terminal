import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, getToolDefinition } from './tool-registry.js';

test('ToolRegistry: contains 5 tool entries', () => {
  assert.equal(ToolRegistry.length, 5);
});

test('ToolRegistry: all entries have name, description, and inputSchema', () => {
  for (const tool of ToolRegistry) {
    assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `${tool.name}: name should be non-empty`);
    assert.ok(typeof tool.description === 'string', `${tool.name}: description should be string`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `${tool.name}: inputSchema should be object`);
  }
});

test('getToolDefinition: returns correct tool for "search_memory"', () => {
  const tool = getToolDefinition('search_memory');
  assert.ok(tool, 'should find search_memory');
  assert.equal(tool?.name, 'search_memory');
});

test('getToolDefinition: returns null for unknown tool name', () => {
  assert.equal(getToolDefinition('nonexistent_tool'), null);
});

test('getToolDefinition: search_memory has required query field', () => {
  const tool = getToolDefinition('search_memory');
  const schema = tool?.inputSchema as { required?: string[] };
  assert.ok(schema?.required?.includes('query'), 'search_memory should require "query"');
});

test('getToolDefinition: get_impact has required file field', () => {
  const tool = getToolDefinition('get_impact');
  const schema = tool?.inputSchema as { required?: string[] };
  assert.ok(schema?.required?.includes('file'), 'get_impact should require "file"');
});

test('ToolRegistry: all expected tool names are present', () => {
  const names = ToolRegistry.map((t) => t.name);
  for (const expected of ['search_memory', 'get_dep_graph', 'get_health_score', 'get_hot_zones', 'get_impact']) {
    assert.ok(names.includes(expected), `missing expected tool: ${expected}`);
  }
});
