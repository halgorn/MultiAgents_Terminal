import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flow, FlowBuilder } from './builder.js';

test('flow: simple step chain runs in order', async () => {
  const calls: string[] = [];
  const myFlow = flow<{ x: number }, number>('test')
    .initialState('PENDING' as never)
    .step('add1', async (ctx) => {
      calls.push('add1');
      return { state: 'RUNNING' as never, output: ctx.input.x + 1 };
    })
    .step('add2', async (ctx) => {
      calls.push('add2');
      return { state: 'RUNNING' as never, output: (ctx.state as unknown as number) + 2 };
    })
    .build();

  const result = await myFlow.run({
    state: 'PENDING' as never,
    input: { x: 10 },
    stepIndex: 0,
    totalSteps: 2,
    emit: () => {},
  });
  assert.deepEqual(calls, ['add1', 'add2']);
  assert.equal(result.output, 13);
});

test('flow: abort strategy throws on step failure', async () => {
  const myFlow = flow<void, number>('test')
    .step('ok', async () => ({ state: 'A' as never, output: 1 }))
    .step('fail', async () => {
      throw new Error('boom');
    })
    .step('never', async () => ({ state: 'B' as never, output: 99 }))
    .build();

  await assert.rejects(
    () => myFlow.run({ state: 'PENDING' as never, input: undefined, stepIndex: 0, totalSteps: 3, emit: () => {} }),
    /boom/,
  );
});

test('flow: skip-and-continue strategy swallows step errors', async () => {
  const calls: string[] = [];
  const myFlow = flow<void, number>('test')
    .step('ok1', async () => { calls.push('ok1'); return { state: 'A' as never, output: 1 }; }, { failureStrategy: 'abort' })
    .step('fail', async () => { throw new Error('skip me'); }, { failureStrategy: 'skip-and-continue' })
    .step('ok2', async () => { calls.push('ok2'); return { state: 'B' as never, output: 2 }; }, { failureStrategy: 'abort' })
    .build();

  const result = await myFlow.run({ state: 'PENDING' as never, input: undefined, stepIndex: 0, totalSteps: 3, emit: () => {} });
  assert.deepEqual(calls, ['ok1', 'ok2']);
  assert.equal(result.output, 2);
});

test('flow: fallback strategy invokes fallback handler', async () => {
  const events: unknown[] = [];
  const myFlow = flow<void, number>('test')
    .step('fail', async () => { throw new Error('primary failed'); }, {
      failureStrategy: 'fallback',
      fallback: async (_err, _ctx) => ({ state: 'FALLBACK' as never, output: 42, reason: 'used default' }),
    })
    .build();

  const result = await myFlow.run({
    state: 'PENDING' as never,
    input: undefined,
    stepIndex: 0,
    totalSteps: 1,
    emit: (e, p) => events.push([e, p]),
  });
  assert.equal(result.output, 42);
  assert.ok(events.some((e) => Array.isArray(e) && e[0] === 'flow:fallback'));
});

test('flow: fanOut runs branches in parallel', async () => {
  const myFlow = flow<void, number[]>('test')
    .fanOut('parallel', [
      { name: 'a', run: async () => ({ state: 'A' as never, output: 1 }) },
      { name: 'b', run: async () => ({ state: 'B' as never, output: 2 }) },
      { name: 'c', run: async () => ({ state: 'C' as never, output: 3 }) },
    ], { concurrency: 2 })
    .build();

  const result = await myFlow.run({ state: 'PENDING' as never, input: undefined, stepIndex: 0, totalSteps: 1, emit: () => {} });
  assert.deepEqual(result.output, [1, 2, 3]);
});

test('flow: fanOut with merge reducer', async () => {
  const myFlow = flow<void, number>('test')
    .fanOut('parallel',
      [
        { name: 'a', run: async () => ({ state: 'A' as never, output: 10 }) },
        { name: 'b', run: async () => ({ state: 'B' as never, output: 20 }) },
      ],
      { concurrency: 2, merge: (outs) => outs.reduce((a, b) => a + b, 0) },
    )
    .build();

  const result = await myFlow.run({ state: 'PENDING' as never, input: undefined, stepIndex: 0, totalSteps: 1, emit: () => {} });
  assert.equal(result.output, 30);
});

test('flow: step timeout aborts the step', async () => {
  const myFlow = flow<void, number>('test')
    .step('slow', async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { state: 'X' as never, output: 1 };
    }, { timeoutMs: 10 })
    .build();

  await assert.rejects(
    () => myFlow.run({ state: 'PENDING' as never, input: undefined, stepIndex: 0, totalSteps: 1, emit: () => {} }),
    /timed out/,
  );
});

test('flow: emit hook fires for flow:skipped on skip-and-continue', async () => {
  const events: string[] = [];
  const myFlow = flow<void, number>('test')
    .step('fail', async () => { throw new Error('skip'); }, { failureStrategy: 'skip-and-continue' })
    .build();

  await myFlow.run({
    state: 'PENDING' as never,
    input: undefined,
    stepIndex: 0,
    totalSteps: 1,
    emit: (e) => events.push(e),
  });
  assert.ok(events.includes('flow:skipped'));
});

test('FlowBuilder: build is idempotent (returns fresh flow each time)', () => {
  const builder = flow<void, number>('test').step('a', async () => ({ state: 'X' as never, output: 1 }));
  const f1 = builder.build();
  const f2 = builder.build();
  assert.equal(f1.name, 'test');
  assert.equal(f2.name, 'test');
  assert.notEqual(f1, f2);
});

test('FlowBuilder: defaultTimeout applies to subsequent steps', () => {
  const b: FlowBuilder<void, number> = flow<void, number>('t').defaultTimeout(5000);
  assert.ok(b instanceof FlowBuilder);
});