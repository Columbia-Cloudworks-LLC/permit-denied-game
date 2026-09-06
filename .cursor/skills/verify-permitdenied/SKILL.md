---
description: Drive PERMIT DENIED sandbox through control-permitdenied and capture PNG plus JSON proof of steer, blade, local smash, and restart.
---

# Verify PERMIT DENIED

Player surface is a window titled `PERMIT DENIED` (logical 320×224, 60 TPS). Starts **in play** (no title). Verification drives `internal/game.Game` through `Update`/`Draw` with scripted keys.

## Launch

```
go build -buildvcs=false -o .cursor/skills/verify-permitdenied/bin/control-permitdenied.exe ./cmd/control-permitdenied
```

## Doctor

```
.cursor/skills/verify-permitdenied/bin/control-permitdenied.exe doctor
```

Expect `"ok": true`, `"title": "PERMIT DENIED"`, `"scene": "play"`, `"screen": "320x224"`.

## Drive

```
.cursor/skills/verify-permitdenied/bin/control-permitdenied.exe drive --out .cursor/skills/verify-permitdenied/artifacts/<run-id> .cursor/skills/verify-permitdenied/scripts/<feature>.script
```

Keys: `w` `a` `s` `d` `space` `enter` `esc` `r` `f1` `f2` `f3`.

Primary sandbox script: `scripts/sandbox-destruction.script` — intact → bitten → collapsing → destroyed → restart.

## Proof bar

- Start already in the dozer (`scene=play`).
- Capture intact / bitten / collapsing / rubble frames.
- `struct_cash` and `rubble` must move with the PNGs.
- `go test ./...` is the unit box; this skill is the live box.
