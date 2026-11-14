/**
 * .what = a JSON.stringify replacer that marks values json cannot hold, instead of a throw or a loss
 * .why = a command must not fail on, or lose, the shape of its own data: an http-client error
 *        carries circular refs, an id from pg is a bigint, and an Error stringifies as `{}`.
 *        the marker stays on record, so each value is labeled, never hidden
 * .note = `function`, not an arrow: the replacer reads its holder via `this`, which an arrow cannot bind
 * .note = deliberate mutation: `ancestors` is the replacer's own path stack, scoped to one stringify
 */
const genTotalReplacer = () => {
  // each ancestor: the object json walks into (`rendered`, the `this` of its children) and the source value
  const ancestors: { rendered: unknown; source: unknown }[] = [];
  return function totalReplacer(
    this: unknown,
    _key: string,
    value: unknown,
  ): unknown {
    // json has no bigint; mark it as text with its suffix
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value !== 'object' || value === null) return value;

    // trim the stack to the holder of this value, so a shared (non-circular) ref is kept whole
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1]!.rendered !== this
    )
      ancestors.pop();

    // a value already on the path from the root is a cycle; mark it
    if (ancestors.some((ancestor) => ancestor.source === value))
      return '[Circular]';

    // an Error keeps its name, message, and stack, which json would drop as non-enumerable
    const rendered =
      value instanceof Error
        ? {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...Object.fromEntries(Object.entries(value)), // own enumerable props, e.g. `code`
          }
        : value;
    ancestors.push({ rendered, source: value });
    return rendered;
  };
};

/**
 * .what = JSON.stringify, made total over circular refs, bigints, and Errors
 * .why = one rule for every place a command renders its data: log entries, out.json, the run id
 * .note = total over those shapes only: a `toJSON` or getter that throws still throws
 */
export const asJsonTotal = (input: {
  value: unknown;
  indent: number | null;
}): string | undefined =>
  JSON.stringify(input.value, genTotalReplacer(), input.indent ?? undefined);
