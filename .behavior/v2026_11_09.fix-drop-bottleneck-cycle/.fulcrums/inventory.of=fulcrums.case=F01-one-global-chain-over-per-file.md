# F01 — one global chain, a chain per file, or a chain per run

## the fork

- **global**: one module-level promise chain; every append from every command waits its turn
- **per-file**: a map of file path → chain; appends to different files run in parallel
- **per-run**: one chain held in the closure of each `genRunLog`; no map, no eviction, no module state; each run's writes serialize among themselves, and runs never wait on each other

## taken: global (as ruled); per-run offered for a re-rule

the prior code built one module-level limiter with an intended cap of 1, so a global serial queue read as the intent. global is ~10 lines; a per-file map needs eviction or it grows with every run dir.

the per-run option removes the eviction cost that ruled out per-file, and every guarantee the tests pin is per file (order, `[` first, `]` last, a failed append that does not stall the chain, late entries after `]`). what it changes:

| | global | per-run |
|---|---|---|
| a command's awaited log waits on other commands' writes | yes | no |
| a wedged mount (one command's `dir` on a slow disk) stalls other commands' logs | yes | no |
| module-level mutable state | one cursor | none |
| match to what shipped (the limiter's option was unread, so commands never waited on each other) | no | yes |

the drive keeps global because the director ruled it; the per-run option surfaced in review after that verdict (peer r011), so it goes back to the director rather than override the verdict.

## rework: clean

the chain sits behind one function, `scheduleFileLog({ task })`, and `genRunLog.ts` is its sole caller. per-run moves the cursor from module scope into `genRunLog`'s closure (~5 lines); the `scheduleFileLog` unit tests become `genRunLog` tests. no caller or contract changes.

## confidence: 70%, why not higher

per-run is the better fit by every property the tests pin, and it removes the cross-command stall. the verdict stands until the director re-rules, so the drive holds global.

## where

`src/scheduleFileLog.ts`, `src/genRunLog.ts`

## verdict

ruled 2026-11-09 by the director at 1.vision approval: global, over per-file. reopened for a re-rule with the per-run option; the drive holds global until then
