/**
 * .what = runs file-log writes one at a time, in call order
 * .why = log entries must land whole and in order, even when the caller does not await;
 *        a promise chain serializes them with no dependency
 * .note = deliberate mutation: `queue.tail` is the one shared cursor of the chain
 * .note = the cursor rides a separate outcome, never the caller's promise: a handler on the
 *         caller's promise would mark an unawaited failure as handled, and hide it
 * .note = one chain per process, shared by every command: a write that rejects frees the
 *         chain at once, but a write that never settles (a wedged disk) holds every later
 *         write in the process. accepted: each task is one local `fs.appendFile`, and a disk
 *         that wedges it would wedge any other write too; a per-file chain would not help.
 *         callers emit to console and stamp each entry before they schedule, so a wedge
 *         holds only the file, never the console or the timestamps
 */
const queue: { tail: Promise<unknown> } = { tail: Promise.resolve() };

export const scheduleFileLog = <T>(input: {
  task: () => Promise<T>;
}): Promise<T> => {
  // run the task behind the prior one; capture its outcome so the cursor never rejects
  const outcome = queue.tail
    .then(() => input.task())
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  // advance the cursor on the outcome, never on the caller's promise (see .note on unawaited failures)
  queue.tail = outcome;

  // hand the caller a fresh promise that settles as the task did
  return outcome.then((settled) =>
    settled.ok ? settled.value : Promise.reject(settled.error),
  );
};
