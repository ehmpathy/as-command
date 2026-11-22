# F4 — 5.3 pins the trust fields here; the step-branch test goes upstream

- **the fork**: the behavior-intent lane (i004 r010) asks for a hermetic test here that runs `.publish-npm.yml`'s `verify oidc auth` and `idempotify` blocks against stubs, case by case. the arch-defects lane (i004 r011) says those files belong to the practice, so a test here gives them a second owner and goes red on a legit upgrade
- **taken**: both, split by owner. here: a test that derives the four trust fields from the repo (org + repo from `package.json#repository`, caller `publish.yml` on `v*`, no `environment:`) and snapshots them. a red there is the true signal that the npm record must change, so it guards the ask, not the practice's text. upstream: the stub-run of the step branches (`.dream/v2026_11_20.reseed.publish-steps-tested-in-practice.md`)
- **rework**: clean. no test is written yet; the 5.3 stone takes the call
- **confidence**: 90%. the residual: the behavior lane may hold that a branch never run in this repo is a gap here, whoever owns it
- **where**: `5.1.execution.from_vision.yield.md` 5.3 todos
- **verdict**: open; the 5.3 lanes and the director read it
