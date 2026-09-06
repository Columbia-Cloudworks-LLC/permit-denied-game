# PERMIT DENIED

**Status:** Milestone 1 is a **destruction sandbox** (compact lot, per-cell buildings). This doc retains the original county-strip fantasy; where it conflicts with cell-based destruction or the sandbox README, the sandbox wins for the current binary.  
**Form:** SNES / Sega Genesis top-down. World-fixed north. 16 facings.  
**Length (sandbox):** ~60 s or death. **Length (legacy strip fantasy):** ~3:30.  
**Hands:** Tank-steer + one blade toggle. That is the whole moveset.

One-line: you are an armored dozer. The lot you wreck *is* the maze. Buildings break locally, cell by cell.

---

## What this is not

- Not a Heemeyer biopic. No manifesto, no real town, no real target list.
- Not Vampire Survivors. No six weapon slots, no 20-minute build.
- Not Hades. No region graph, shops, or unlock tree in this spec.
- Not BeamNG soft-body. Debris particles are garnish; **rubble cells collide** and match their sprites.
- Not *Smashy Road* in a hat. You are slow, heavy, and punished for filling the street you still need.

Internal shorthand “Killdozer” stays off the title screen.

---

## The lot — county industrial strip

Two to three screens. One long main drag, two side lots, a dead-end rail spur.

| Place | Where | Role |
|---|---|---|
| South gate | Spawn | Facing **north**. Tutorial is the strip itself. |
| Sheriff’s office | Mid-drag | Named target. Easy. |
| Public-works yard | East side lot, behind a choke | Named target. Detour. |
| Batch plant | Far north pad, open ground | Named target. Greedy. |
| Drag intersections | — | Blocker homes. |
| Plant pad | — | Chopper and heavy punish open ground. |
| At least one choke | Yard mouth / a crossing | You will regret filling it with rubble. |

All three named targets are visible from spawn. No hunt, no fog.

---

## You

**Machine fantasy:** mass, blade, momentum, getting buried in your own pile.

| Stance | Forward | Turn / reverse | Combat |
|---|---|---|---|
| **Blade up** | Fast | Better | No brace. Cruisers peel side/rear. Glances off buildings. |
| **Blade down** | Crawl | Worse | Frontal brace. Wrecks structures. Cooks if you keep pushing wall or deep rubble. |

Reverse is slow and wide in both stances. Boxed-in-by-yourself is the skill check.

**Armor — four onion plates** (palette swaps, not locational panels):

1. Paint  
2. Primer  
3. Rust hull  
4. Black frame  

Frame + one heavy hit = thrown track, run over.  
Cruisers peel only side/rear, and only if blade is up.  
Frontal blade-down does not peel.  
Excavator boom peels any stance.  
Chopper peels nothing.

**Heat** is a sprite state (flush red / vents), not a HUD number.

- Blade-down on a wall or deep rubble cooks.  
- Blade-up on open asphalt cools.  
- Wedged / stalled cooks fastest.  
- Cooked engine = death, same tally screen as a thrown track or the buzzer.

**Death is loss of mobility.** Not hearts.

---

## Hands

**Keyboard:** `A`/`D` rotate · `W` forward · `S` reverse · `Space` toggle blade.

**Phone:** tiller + throttle + blade.

- Left thumb = heading.  
- Right **hold** = throttle (slide up forward, slide down reverse).  
- Right **tap** = blade toggle.

Two thumbs. Reverse is first-class. Fallback if playtest fails: auto-creep forward (not in this spec until proven).

**Camera:** world-fixed north. Dozer has 16 facings. Camera does not yaw with the machine.

---

## Authorities — four families

If a threat does not change how you **steer**, it does not ship.

| Family | Tell | What it does | Counter |
|---|---|---|---|
| **Cruisers** | Light bar | Hunt side and rear. PIT / peel when blade is up. Die on a blade-down face. Do **not** block streets. | Face them, or smash sheriff. |
| **Blockers** | Dump trucks, jersey walls, concrete patches | Occupy cells. Change the corridor. | Shove while wet; smash yard / plant. |
| **Heavy — county excavator** | Boom silhouette, not a second dozer | Does not chase. Plants in a corridor and *takes the street* at ~1:45. Boom swipe punishes blade-up. Blade-down can ram its tracks; you cook. | Flatten the yard before it arrives, or bury its swing side in rubble. |
| **Chopper** | Spotlight cone | No rockets. Linger in the cone → next blocker or heavy arrives early. It is the clock with a sprite. | Leave the cone. Not deletable. |

Foot cops are garnish only: they exist to be flattened. No system.

**Soft counter:** concrete patches **set at 2:15** unless the batch plant is already dead. Then they stay shoveable.

---

## Named targets and boons

Three. Visible at spawn. Ignore allowed. Boons counter the **response**, not the dozer body.

| Target | Sit | Smash it → |
|---|---|---|
| Sheriff’s office | Mid-drag, easy | Cruisers lose PIT; they bounce off armor instead of peeling plates. |
| Public-works yard | Side lot, behind a choke | No more dump-truck plugs. Jersey walls crack in one pass. |
| Batch plant | Far pad, greedy | Concrete patches never set. |

Chopper cannot be deleted. A fourth “radio tower” target is out of spec.

**Greed:** a first-session player dies ~1:20 with one target or none. A learned run hits two and the buzzer. Three targets + buzzer is a story, not the expected score.

---

## Beat chart (if you live)

| Time | Town does |
|---|---|
| 0:00 | Cruisers only. Streets open. |
| 0:40 | First blockers drop on the drag. |
| 1:00 | Chopper spotlight. |
| 1:20 | Excavator *announces* from the yard. |
| 1:45 | Excavator arrives unless the yard is already dead. |
| 2:15 | Concrete patches start setting unless the plant is dead. |
| 2:45 | Two families at once. |
| 3:30 | Buzzer. Score lock. |

---

## Score

```
(structure $ + vehicle $ + time alive) × multiplier
```

| Named targets smashed | Multiplier |
|---|---|
| 0 | 1.0 |
| 1 | 1.25 |
| 2 | 1.6 |
| 3 | 2.0 |

Three-target ×2.0 was not in the spoken lock (`1.0 / 1.25 / 1.6`). It is the smallest completion that makes the greedy third target matter. Reject it and cap at 1.6 if you want the original three-step flag only.

Dollar ticks fly on wrecks during the run. The freeze-frame tally is the highlight reel: structure $ → vehicle $ → time → multiplier.

---

## How a building dies (16-bit)

Three tile states only:

1. Intact  
2. Cracked  
3. Rubble pile — **real collision**

No debris-as-gameplay particles. Rubble that doesn’t collide is a lie.

---

## Run end

Buzzer **or** death (cooked, thrown track, buried-and-cooked) → **same** screen:

- Freeze-frame of the lot as you left it.  
- Tally roll.  
- One button: **again**.  

Same lot. No new seed required for the show-off. No limp-out cutscene. No Hades map.

---

## Garnish that ships

- Dollar ticks on wrecks  
- One-frame hit-stop on blade-down into a building  
- Short screen shake  
- A handful of foot cops (flatten-only)  
- Genesis-style crunch + a two-channel chase loop  

No voice. No radio play-by-play. No wanted-star HUD. No numeric heat or HP.

---

## Explicitly out of this spec

- Between-run unlocks, colors-as-meta, ghost replay (ghost-best is allowed *after* a playable, not before)  
- Body boons (fuel depot, welding bay, extra plates as loot)  
- Vision-slit camera  
- Rockets on the chopper  
- Mirror-match second dozer  
- Cement mixer as a second concrete system  
- Locational armor panels  
- Soft-body physics  
- A campaign map  

---

## Later, if the lot is actually fun (not this document)

Working fiction only: a hilarious crusade about one man’s failure to secure the permit for his shed. That story can name later lots. It does not change spawn, targets, or tone on *this* strip.

---

## Show-off test

The level is done enough to show when:

1. A new player can steer, toggle blade, and die inside 90 seconds without a tooltip wall.  
2. Someone who learned the strip can point at the plant and say whether they have time.  
3. A coward run and a two-target run do not cash out the same.  
4. You can read heat and armor off the sprite.  
5. Rubble you made has already stolen a street you needed.

If those five fail, do not expand. Expand only if they hold.
