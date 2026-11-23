# F5 — the asks inventory stays box-local

## .the fork
the route's asks inventory (`asks.inventory.jsonl`, written by the achiever's prompt hook) holds each peer message verbatim, clock times included. the repo's `check.timestamps` pre-commit hook refuses any tracked file with a clock time, and allows no exemption. the achiever's goal guard forbids any direct read, edit, or unstage of that path.

- A: commit the inventory with its clock times masked
- B: keep the inventory out of the commit, as box-local session state

## .taken
B. the route's `.gitignore` names `asks.inventory.jsonl`, so a re-stage of the route directory skips it.

## .why
- A is not open: the mask is a direct edit of a guarded path
- the inventory is a hook's per-session capture of raw peer messages, like the route daemon's logs. a reader of the pr gains no concept from it; the seeds hold the utterances that changed the work
- the file was staged before the guard's scope was clear, so one human unstage is owed: `git restore --staged .behavior/v2026_11_20.fix-publish-1-1-0/.goals/asks.inventory.jsonl`

## .rework
clean: delete the one ignore line, mask the clock times, and stage it.

## .confidence
85%. low because the achiever readme names visibility and audit as a reason to persist goals; whether its asks inventory is meant to ship is the achiever's call, not this route's.

## .where
`.behavior/v2026_11_20.fix-publish-1-1-0/.gitignore`

## .the root
the achiever writes raw peer text into a tracked path with no mask for clock times. caught as `.dream/v2026_11_22.reseed.asks-inventory-masks-clock-times.md`.
