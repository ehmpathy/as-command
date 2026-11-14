# F08 — the console gets the same total render as `log.json`

## the fork

peer review r010 (5.3, l3, rounds 2 and 3) found two faults on the console path, both from one cause: `options.log` got the raw metadata, and the adopter's logger (`simple-leveled-log-methods`, `formatLogContentsForEnvironment.js:13,18`) stringifies it in local and aws-lambda.

- an `Error` renders `{}`: its message is lost from the console and cloudwatch
- a circular ref or a bigint throws a `TypeError` inside the logger; in the `catch`, that error replaces the caller's own

main had the second fault too (`{ ...error, message }` kept a circular `request`); the first came from this branch's `output.error` change.

- **a**: hand the console a json-safe deep copy, rendered by the same `asJsonTotal` that writes `log.json` (`asJsonClone`)
- **b**: hand the console the raw value, and narrow the catalog's claim: snap the `TypeError` as a known edge, as cell 8 was
- **c**: wrap the console call in a guard that swallows a logger throw

## taken: a

- one render rule for both outputs: the console line and the file entry mark the same values the same way (an `Error` as `name`, `message`, `stack`, own props; `[Circular]`; `42n`)
- the caller always gets its own error; an on-call engineer sees the upstream message in cloudwatch (cells 28, 29, 41)
- the copy is taken at the call, so a later mutation reaches neither output (cell 31)
- c is a failhide: it hides a logger fault rather than prevent it
- b keeps a defect a one-line transformer removes

## rework: clean

one line in `src/asCommand.ts` (`asJsonClone({ value: metadata })` → `metadata`) and one transformer file. no caller depends on the console's metadata identity: `LogMethods` is a sink.

## confidence: 85%, why not higher

the console now gets a copy, not the object the author passed. a logger that inspects live objects (the web-browser branch of `simple-leveled-log-methods`, a custom logger that reads class instances) sees plain json instead: a `Date` becomes its iso string, a function vanishes, a class instance loses its prototype. no adopter path in this org is known to read those, yet it is a change in what the console receives.

## where

`src/asCommand.ts` (`logLevelAbstraction`), `src/asJsonClone.ts`, catalog cells 28, 29, 31, 41

## verdict

open — best-guess taken; a wisher veto is a clean rework
