# F02 — the `[` and `]` appends ride the chain

## the fork

- **leave as is**: only `log.*` entries use the chain; `[` and `]` append directly, as today
- **on the chain**: `[` and `]` are scheduled too, so `]` lands after every entry queued before it

## taken: on the chain

logic that fires `context.log.*` without await (the extant all-log-levels test does) leaves entries queued when `finally` appends `]`. off the chain, `]` can land before them. the wish asks that file-log writes serialize in order; `]` is a file-log write.

## rework: clean

two call sites in `src/asCommand.ts`; revert = unwrap them.

## confidence: 92%, why not higher

the wish names log writes, not the brackets; this widens the guarantee by one line each. `log.json` is not valid json either way, so a reader that parses it is unaffected.

## where

`src/asCommand.ts` — the `[` append before `log.info('input')`, the `]` append in `finally`

## verdict

ruled 2026-11-09 by the director at 1.vision approval: taken as chosen
