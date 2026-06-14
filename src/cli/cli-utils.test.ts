import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBudget, parsePositiveInt } from './cli-utils.js';

// ── parseBudget ───────────────────────────────────────────────────────────────

test('parseBudget: "low" returns low', () => {
  assert.equal(parseBudget('low'), 'low');
});

test('parseBudget: "normal" returns normal', () => {
  assert.equal(parseBudget('normal'), 'normal');
});

test('parseBudget: "deep" returns deep', () => {
  assert.equal(parseBudget('deep'), 'deep');
});

test('parseBudget: unknown value falls back to low', () => {
  assert.equal(parseBudget('ultra'), 'low');
  assert.equal(parseBudget(''), 'low');
  assert.equal(parseBudget('NORMAL'), 'low');
});

// ── parsePositiveInt ──────────────────────────────────────────────────────────

test('parsePositiveInt: parses valid integer', () => {
  assert.equal(parsePositiveInt('50', 10, 100), 50);
});

test('parsePositiveInt: undefined returns fallback', () => {
  assert.equal(parsePositiveInt(undefined, 10, 100), 10);
});

test('parsePositiveInt: value above max is clamped to max', () => {
  assert.equal(parsePositiveInt('200', 10, 100), 100);
});

test('parsePositiveInt: zero string uses fallback (parseInt 0 is falsy)', () => {
  assert.equal(parsePositiveInt('0', 10, 100), 10);
});

test('parsePositiveInt: negative is floored to 1', () => {
  assert.equal(parsePositiveInt('-5', 10, 100), 1);
});

test('parsePositiveInt: non-numeric string returns fallback', () => {
  assert.equal(parsePositiveInt('abc', 10, 100), 10);
});

test('parsePositiveInt: value exactly at max is accepted', () => {
  assert.equal(parsePositiveInt('100', 10, 100), 100);
});

test('parsePositiveInt: value exactly at 1 is accepted', () => {
  assert.equal(parsePositiveInt('1', 10, 100), 1);
});
