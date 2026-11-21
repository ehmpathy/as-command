import { given, then, when } from 'test-fns';

import { asRunId } from './asRunId';

// a fixed local-time instant, so the date prefix does not depend on the host clock
const calledAt = new Date(2026, 10, 14, 9, 15, 30);

const TEST_CASES = [
  {
    description:
      'prefixes the second of the call, then the sha256 of the input',
    given: { calledAt, input: { value: 21 } },
    expect: {
      runId: /^20261114\.091530\.[0-9a-f]{64}$/,
    },
  },
];

describe('asRunId', () => {
  TEST_CASES.map((thisCase, index) =>
    given(`[case${index + 1}] a call instant and an input`, () => {
      when('a run id is cast', () => {
        then(thisCase.description, () => {
          expect(asRunId(thisCase.given)).toMatch(thisCase.expect.runId);
        });
      });
    }),
  );

  given('[case2] an input json cannot hold (bigint, undefined)', () => {
    when('a run id is cast', () => {
      then('it still yields a run id', () => {
        expect(asRunId({ calledAt, input: { id: BigInt(42) } })).toMatch(
          /^20261114\.091530\.[0-9a-f]{64}$/,
        );
        expect(asRunId({ calledAt, input: undefined })).toMatch(
          /^20261114\.091530\.[0-9a-f]{64}$/,
        );
      });
    });
  });

  given('[case3] two inputs, equal or different', () => {
    when('each is cast to a run id', () => {
      then(
        'the same input yields the same hash; a different input, a different hash',
        () => {
          const hashOf = (input: unknown) =>
            asRunId({ calledAt, input }).split('.')[2];
          expect(hashOf({ value: 21 })).toEqual(hashOf({ value: 21 }));
          expect(hashOf({ value: 21 })).not.toEqual(hashOf({ value: 22 }));
        },
      );
    });
  });
});
