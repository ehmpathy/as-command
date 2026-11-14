import { given, then, when } from 'test-fns';

import { asOutFileContent } from './asOutFileContent';

const TEST_CASES = [
  {
    description: 'keeps a string output as is',
    given: { output: 'hello kai' },
    expect: { content: 'hello kai' },
  },
  {
    description: 'renders an object output as pretty json',
    given: { output: { doubled: 42 } },
    expect: { content: '{\n  "doubled": 42\n}' },
  },
  {
    description: 'marks a bigint in the output, instead of a throw',
    given: { output: { id: BigInt(42) } },
    expect: { content: '{\n  "id": "42n"\n}' },
  },
  {
    description: 'writes an undefined output as the word undefined',
    given: { output: undefined },
    expect: { content: 'undefined' },
  },
];

describe('asOutFileContent', () => {
  TEST_CASES.map((thisCase, index) =>
    given(`[case${index + 1}] a command output`, () => {
      when('rendered for out.json', () => {
        then(thisCase.description, () => {
          expect(asOutFileContent(thisCase.given)).toEqual(
            thisCase.expect.content,
          );
        });
      });
    }),
  );
});
