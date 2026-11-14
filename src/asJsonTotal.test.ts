import { given, then, when } from 'test-fns';

import { asJsonTotal } from './asJsonTotal';

const TEST_CASES = [
  {
    description: 'renders plain json as JSON.stringify would',
    given: { value: { a: 1, b: ['x'] } },
    expect: { json: '{"a":1,"b":["x"]}' },
  },
  {
    description: 'marks a circular ref as "[Circular]"',
    given: {
      value: (() => {
        const request: { url: string; self?: unknown } = { url: '/x' }; // .note = deliberate mutation: builds a cycle
        request.self = request;
        return { request };
      })(),
    },
    expect: { json: '{"request":{"url":"/x","self":"[Circular]"}}' },
  },
  {
    description: 'marks a bigint as "<n>n"',
    given: { value: { id: BigInt(42) } },
    expect: { json: '{"id":"42n"}' },
  },
  {
    description: 'keeps a shared, non-circular ref whole at each place',
    given: {
      value: (() => {
        const spot = { name: 'trestles' };
        return { from: spot, to: spot };
      })(),
    },
    expect: { json: '{"from":{"name":"trestles"},"to":{"name":"trestles"}}' },
  },
  {
    description:
      'keeps an Error as its name and message (not `{}`), plus its own props',
    given: {
      value: {
        error: Object.assign(new Error('upstream refused'), {
          code: 'E_REFUSED',
          stack: 'stack.of.error',
        }),
      },
    },
    expect: {
      json: '{"error":{"name":"Error","message":"upstream refused","stack":"stack.of.error","code":"E_REFUSED"}}',
    },
  },
  {
    description:
      'marks a cycle that runs through an Error, and does not recurse forever',
    given: {
      value: (() => {
        const error = Object.assign(new Error('loop'), {
          stack: 'stack.of.loop',
          self: null as unknown,
        }); // .note = deliberate mutation: builds a cycle through an Error
        error.self = error;
        return { error };
      })(),
    },
    expect: {
      json: '{"error":{"name":"Error","message":"loop","stack":"stack.of.loop","self":"[Circular]"}}',
    },
  },
];

describe('asJsonTotal', () => {
  TEST_CASES.map((thisCase, index) =>
    given(`[case${index + 1}] a value to render`, () => {
      when('rendered with no indent', () => {
        then(thisCase.description, () => {
          expect(
            asJsonTotal({ value: thisCase.given.value, indent: null }),
          ).toEqual(thisCase.expect.json);
        });
      });
    }),
  );

  given(`[case${TEST_CASES.length + 1}] the value undefined`, () => {
    when('rendered', () => {
      then('it returns undefined, as JSON.stringify does', () => {
        expect(asJsonTotal({ value: undefined, indent: null })).toBeUndefined();
      });
    });
  });
});
