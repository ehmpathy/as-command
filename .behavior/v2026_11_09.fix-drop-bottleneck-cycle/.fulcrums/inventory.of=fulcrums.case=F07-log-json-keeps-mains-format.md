# F07 — `log.json` keeps main's byte format; valid json is a separate change

## the fork

peer review r006 (5.3, `ergo-snapshot-visual-blemishes`) flags that each `log.json` snapshot ends with `},` before `]`, so the file does not parse as json, and that a late entry lands after `]`.

- **a**: make `log.json` valid json in this pr (no comma after the last entry; a late entry inside the array, or dropped)
- **b**: keep main's format; pin it in snapshots; carry the valid-json change as its own followup

## taken: b

- the format is main's, byte for byte: main appended `${JSON.stringify(entry, null, 2)},\n` per entry and `]\n` in `finally` (`main:src/asCommand.ts:72-78, 142`). this pr moved the writes onto one chain; it did not change a byte of the format
- the wish is the bottleneck drop with order kept; the vision answered "should `log.json` become valid json?" → no, not asked, and named it under `.what is awkward?`
- valid json changes every adopter's `log.json` bytes, and any reader that strips the comma by hand would break: a contract change that wants its own pr, its own release note, and a minor bump
- a late entry after `]` (cell 25) is deliberate: a seal guard would drop the entry from the file, which hides it. the valid-json change must decide where a late entry goes, so it belongs to that same followup
- the snapshots record the format as it is, so the followup's diff will show every byte that moves

## rework: clean

the change lives in `asLogEntryLine` (the comma) and `genRunLog` (where the comma goes, and the seal); the snapshots move with it. no caller is hardened against either shape.

## confidence: 88%, why not higher

a reader may count "the file is not json" as a defect this pr ships, since it ships the snapshots that show it. it shipped on main either way.

## where

`src/asLogEntryLine.ts`, `src/genRunLog.ts`, `src/__snapshots__/asCommand.integration.test.ts.snap`, `acceptance/__snapshots__/asCommand.acceptance.test.ts.snap`

## verdict

open — best-guess taken; a wisher veto is a clean rework

## dream

`.dream/v2026_11_14.followup.log-json-valid-json.md`
