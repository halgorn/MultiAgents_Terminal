import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VoyageCode3Provider,
  OpenAITextEmbedding3SmallProvider,
  CohereEmbedV3Provider,
  createDefaultProviders,
} from './providers.js';

test('VoyageCode3Provider: not configured without API key', () => {
  const oldKey = process.env['VOYAGE_API_KEY'];
  delete process.env['VOYAGE_API_KEY'];
  try {
    const p = new VoyageCode3Provider();
    assert.equal(p.isConfigured(), false);
    assert.equal(p.id, 'voyage-code-3');
    assert.equal(p.dim, 1024);
  } finally {
    if (oldKey) process.env['VOYAGE_API_KEY'] = oldKey;
  }
});

test('VoyageCode3Provider: configured with API key', () => {
  process.env['VOYAGE_API_KEY'] = 'test-key';
  try {
    const p = new VoyageCode3Provider();
    assert.equal(p.isConfigured(), true);
  } finally {
    delete process.env['VOYAGE_API_KEY'];
  }
});

test('VoyageCode3Provider: embedBatch throws without key', async () => {
  const oldKey = process.env['VOYAGE_API_KEY'];
  delete process.env['VOYAGE_API_KEY'];
  try {
    const p = new VoyageCode3Provider();
    await assert.rejects(() => p.embedBatch(['hello']), /VOYAGE_API_KEY/);
  } finally {
    if (oldKey) process.env['VOYAGE_API_KEY'] = oldKey;
  }
});

test('OpenAITextEmbedding3SmallProvider: configured with key', () => {
  process.env['OPENAI_API_KEY'] = 'test-key';
  try {
    const p = new OpenAITextEmbedding3SmallProvider();
    assert.equal(p.isConfigured(), true);
    assert.equal(p.dim, 1536);
    assert.equal(p.model, 'text-embedding-3-small');
  } finally {
    delete process.env['OPENAI_API_KEY'];
  }
});

test('OpenAITextEmbedding3SmallProvider: throws without key', async () => {
  delete process.env['OPENAI_API_KEY'];
  const p = new OpenAITextEmbedding3SmallProvider();
  await assert.rejects(() => p.embedBatch(['x']), /OPENAI_API_KEY/);
});

test('CohereEmbedV3Provider: configured with key', () => {
  process.env['COHERE_API_KEY'] = 'test-key';
  try {
    const p = new CohereEmbedV3Provider();
    assert.equal(p.isConfigured(), true);
    assert.equal(p.dim, 1024);
  } finally {
    delete process.env['COHERE_API_KEY'];
  }
});

test('CohereEmbedV3Provider: throws without key', async () => {
  delete process.env['COHERE_API_KEY'];
  const p = new CohereEmbedV3Provider();
  await assert.rejects(() => p.embedBatch(['x']), /COHERE_API_KEY/);
});

test('createDefaultProviders: returns 3 providers', () => {
  const providers = createDefaultProviders();
  assert.equal(providers.length, 3);
  assert.ok(providers.some((p) => p.id === 'voyage-code-3'));
  assert.ok(providers.some((p) => p.id === 'openai-text-embedding-3-small'));
  assert.ok(providers.some((p) => p.id === 'cohere-embed-v3'));
});