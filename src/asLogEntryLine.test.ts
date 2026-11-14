import { given, then, when } from 'test-fns';

import { asLogEntryLine } from './asLogEntryLine';

const TEST_CASES = [
  {
    description: 'renders a pretty-printed entry, followed by a comma',
    given: {
      level: 'info',
      timestamp: '2026-11-14T00:00:00.000Z',
      message: 'processed',
      metadata: { step: 1 },
    },
    expect: {
      output:
        '{\n  "level": "info",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "processed",\n  "metadata": {\n    "step": 1\n  }\n},\n',
    },
  },
  {
    description: 'omits metadata when none is given',
    given: {
      level: 'warn',
      timestamp: '2026-11-14T00:00:00.000Z',
      message: 'no metadata',
      metadata: undefined,
    },
    expect: {
      output:
        '{\n  "level": "warn",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "no metadata"\n},\n',
    },
  },
  {
    description: 'marks a circular ref instead of a throw',
    given: {
      level: 'error',
      timestamp: '2026-11-14T00:00:00.000Z',
      message: 'circular',
      metadata: (() => {
        const request: { url: string; self?: unknown } = { url: '/x' }; // .note = deliberate mutation: builds a cycle
        request.self = request;
        return { request };
      })(),
    },
    expect: {
      output:
        '{\n  "level": "error",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "circular",\n  "metadata": {\n    "request": {\n      "url": "/x",\n      "self": "[Circular]"\n    }\n  }\n},\n',
    },
  },
  {
    description: 'marks a bigint instead of a throw',
    given: {
      level: 'info',
      timestamp: '2026-11-14T00:00:00.000Z',
      message: 'bigint',
      metadata: { count: BigInt(7) },
    },
    expect: {
      output:
        '{\n  "level": "info",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "bigint",\n  "metadata": {\n    "count": "7n"\n  }\n},\n',
    },
  },
  {
    description:
      'keeps a shared, non-circular ref whole at each place it appears',
    given: {
      level: 'info',
      timestamp: '2026-11-14T00:00:00.000Z',
      message: 'shared',
      metadata: (() => {
        const spot = { name: 'trestles' };
        return { from: spot, to: spot };
      })(),
    },
    expect: {
      output:
        '{\n  "level": "info",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "shared",\n  "metadata": {\n    "from": {\n      "name": "trestles"\n    },\n    "to": {\n      "name": "trestles"\n    }\n  }\n},\n',
    },
  },
];

describe('asLogEntryLine', () => {
  TEST_CASES.map((thisCase, index) =>
    given(`[case${index + 1}] a log entry`, () => {
      when('rendered as a log.json block', () => {
        then(thisCase.description, () => {
          expect(asLogEntryLine(thisCase.given)).toEqual(
            thisCase.expect.output,
          );
        });
      });
    }),
  );
});
