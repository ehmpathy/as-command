import { getError, given, then, when } from 'test-fns';

import { scheduleFileLog } from './scheduleFileLog';

const sleep = (input: { ms: number }) =>
  new Promise((done) => setTimeout(done, input.ms));

describe('scheduleFileLog', () => {
  given('tasks scheduled back to back', () => {
    when('the first task is slower than the second', () => {
      then('they run one at a time, in call order', async () => {
        // record each start and end in time order (deliberate mutation: it observes side effects)
        const events: string[] = [];
        const task = (input: { name: string; ms: number }) => async () => {
          events.push(`${input.name}.start`);
          await sleep({ ms: input.ms });
          events.push(`${input.name}.end`);
        };

        // schedule a slow task, then a fast one, without a wait between
        await Promise.all([
          scheduleFileLog({ task: task({ name: 'a', ms: 30 }) }),
          scheduleFileLog({ task: task({ name: 'b', ms: 1 }) }),
        ]);
        expect(events).toEqual(['a.start', 'a.end', 'b.start', 'b.end']);
      });
    });

    when('a task fails', () => {
      then(
        'its caller sees the error and the next task still runs',
        async () => {
          const failed = scheduleFileLog({
            task: async () => {
              throw new Error('append failed');
            },
          });
          const next = scheduleFileLog({ task: async () => 'ran' });
          const error = await getError(failed);
          expect(error.message).toEqual('append failed');
          expect(await next).toEqual('ran');
        },
      );
    });
  });
});
