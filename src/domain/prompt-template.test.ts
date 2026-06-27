import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentPrompt, buildJsonOnlyPreamble } from './prompt-template.js';

test('buildAgentPrompt: includes role, steps, output sections', () => {
  const out = buildAgentPrompt({
    role: 'You are a test agent.',
    steps: ['Step one', 'Step two'],
    outputJson: { type: 'object', properties: { x: { type: 'string' } } },
  });
  assert.match(out, /# Role/);
  assert.match(out, /You are a test agent\./);
  assert.match(out, /## Steps/);
  assert.match(out, /1\. Step one/);
  assert.match(out, /2\. Step two/);
  assert.match(out, /## Output/);
  assert.match(out, /"type": "object"/);
});

test('buildAgentPrompt: includes allowed tools', () => {
  const out = buildAgentPrompt({
    role: 'r',
    steps: ['s'],
    allowedTools: ['Read', 'Write', 'Bash'],
  });
  assert.match(out, /## Allowed Tools/);
  assert.match(out, /- Read/);
  assert.match(out, /- Write/);
  assert.match(out, /- Bash/);
});

test('buildAgentPrompt: includes constraints', () => {
  const out = buildAgentPrompt({
    role: 'r',
    steps: ['s'],
    constraints: ['No network access', 'No system commands'],
  });
  assert.match(out, /## Constraints/);
  assert.match(out, /No network access/);
});

test('buildAgentPrompt: includes extras', () => {
  const out = buildAgentPrompt({
    role: 'r',
    steps: ['s'],
    extras: { 'Custom Section': 'with value' },
  });
  assert.match(out, /## Custom Section/);
  assert.match(out, /with value/);
});

test('buildAgentPrompt: includes injection defense by default', () => {
  const out = buildAgentPrompt({ role: 'r', steps: ['s'] });
  assert.match(out, /UNTRUSTED/);
  assert.match(out, /ignore previous/);
});

test('buildAgentPrompt: can opt out of injection defense', () => {
  const out = buildAgentPrompt({ role: 'r', steps: ['s'], includeInjectionDefense: false });
  assert.doesNotMatch(out, /UNTRUSTED/);
});

test('buildJsonOnlyPreamble: contains JSON directives', () => {
  const out = buildJsonOnlyPreamble();
  assert.match(out, /JSON object/);
  assert.match(out, /no prose/i);
});

test('buildAgentPrompt: handles missing outputJson', () => {
  const out = buildAgentPrompt({ role: 'r', steps: ['s'] });
  assert.doesNotMatch(out, /## Output/);
});

test('buildAgentPrompt: handles missing allowedTools and constraints', () => {
  const out = buildAgentPrompt({ role: 'r', steps: ['s'] });
  assert.doesNotMatch(out, /## Allowed Tools/);
  assert.doesNotMatch(out, /## Constraints/);
});