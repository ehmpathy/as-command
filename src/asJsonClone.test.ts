import { given, then, when } from 'test-fns';

import { asJsonClone } from './asJsonClone';

// an Error with an own prop, as an sdk throws it
const errorWithCode = Object.assign(new Error('daily cap reached'), {
  code: 'E_QUOTA',
});

// an http-client style error: its request points back at itself
const errorCircular = Object.assign(new Error('upstream refused'), {
  request: {} as { self?: unknown },
});
errorCircular.request.self = errorCircular.request; // .note = deliberate mutation: builds the cycle

const TEST_CASES = [
  {
    description: 'copies plain json as is',
    given: { value: { input: { name: 'kai', waves: [6, 8] } } },
    expect: { clone: { input: { name: 'kai', waves: [6, 8] } } },
  },
  {
    description:
      'lifts an Error into a record of name, message, stack, then own props',
    given: { value: { error: errorWithCode } },
    expect: {
      clone: {
        error: {
          name: 'Error',
          message: 'daily cap reached',
          stack: errorWithCode.stack,
          code: 'E_QUOTA',
        },
      },
    },
  },
  {
    description:
      'marks a circular ref, and keeps the message of the Error that holds it',
    given: { value: { error: errorCircular } },
    expect: {
      clone: {
        error: {
          name: 'Error',
          message: 'upstream refused',
          stack: errorCircular.stack,
          request: { self: '[Circular]' },
        },
      },
    },
  },
  {
    description: 'marks a bigint as text with its suffix',
    given: { value: { id: BigInt(42) } },
    expect: { clone: { id: '42n' } },
  },
  {
    description:
      'reshapes what json cannot hold, the same as log.json: a Date as its iso text, a Map or Set as {}, a function or undefined key dropped',
    given: {
      value: {
        at: new Date('2026-11-14T06:00:00.000Z'),
        tags: new Set(['reef']),
        index: new Map([['kai', 1]]),
        onDone: () => undefined,
        note: undefined,
      },
    },
    expect: { clone: { at: '2026-11-14T06:00:00.000Z', tags: {}, index: {} } },
  },
  {
    description: 'passes undefined through',
    given: { value: undefined },
    expect: { clone: undefined },
  },
];

describe('asJsonClone', () => {
  TEST_CASES.map((thisCase, index) =>
    given(`[case${index + 1}] a value a logger will receive`, () => {
      when('cloned', () => {
        then(thisCase.description, () => {
          expect(asJsonClone(thisCase.given)).toEqual(thisCase.expect.clone);
        });
      });
    }),
  );

  given('[case7] a circular Error, cloned', () => {
    when('the clone is stringified, as the adopter logger does', () => {
      then('it does not throw, and the message survives', () => {
        expect(() => JSON.stringify({ error: errorCircular })).toThrow(
          /circular/i,
        );
        expect(
          JSON.stringify(asJsonClone({ value: { error: errorCircular } })),
        ).toContain('"message":"upstream refused"');
      });
    });
  });

  given('[case8] metadata mutated after the clone', () => {
    when('the source object changes', () => {
      then('the clone keeps the value as it was at the call', () => {
        const metadata = { status: 'queued' };
        const clone = asJsonClone({ value: metadata });
        metadata.status = 'mutated'; // .note = deliberate mutation: the change the clone must not see
        expect(clone).toEqual({ status: 'queued' });
      });
    });
  });
});
