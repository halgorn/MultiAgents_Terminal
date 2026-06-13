import test from 'node:test';
import assert from 'node:assert/strict';
import { displayProjectName } from './project-name.js';

test('displayProjectName: extracts last path segment', () => {
  assert.equal(displayProjectName('/home/user/my-project'), 'my-project');
});

test('displayProjectName: handles Windows-style backslash paths', () => {
  assert.equal(displayProjectName('C:\\Users\\user\\my-app'), 'my-app');
});

test('displayProjectName: MultiAgents_Terminal maps to Aion', () => {
  assert.equal(displayProjectName('/home/user/MultiAgents_Terminal'), 'Aion');
});

test('displayProjectName: case-insensitive Aion mapping (multiagentsterminal)', () => {
  assert.equal(displayProjectName('multiagentsterminal'), 'Aion');
});

test('displayProjectName: plain name passes through unchanged', () => {
  assert.equal(displayProjectName('my-app'), 'my-app');
});

test('displayProjectName: empty string returns fallback', () => {
  assert.equal(displayProjectName('', 'project'), 'project');
});
