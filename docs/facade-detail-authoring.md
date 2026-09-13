# Mounted facade details

Building packages may declare `facadeDetails` alongside their roof and feature settings:

```json
"facadeDetails": [
  { "id": "shop-sign", "kind": "signboard", "floor": 0,
    "gx": 1, "gy": 5, "side": "south", "width": 3, "text": "BAKERY" }
]
```

Coordinates are integer cells in the complete building footprint. Width is 1–4 cells along the selected south or east frontage. Every cell in that span must exist and have an exposed outward face; all are required mounting points. IDs are unique within the building. Optional lettering accepts uppercase A–Z, digits and spaces, up to 16 characters.

Supported kinds are `signboard`, `marquee`, `clock-face`, `roll-up-door`, `porch`, `fire-escape`, `entry-steps` and `display-glazing`. Porches, shutters and steps are ground-floor details. Fire escapes require an upper floor. Clock faces are static. Marquees have projecting brackets, a canopy, lettering and a light strip.

These attachments share the mounting wall's controlled failure and vanish with its debris when a required mount is gone. Display glazing additionally uses explicit glass cladding HP on each mount: panes break before the bearing frame and emit glass debris. Broken panes expose a dark frame opening; they do not remove the supporting wall's collision. Other details have no separate HP or collision. Steps leave entrance collision unchanged; fire escapes provide no traversal. The outdoor loading-dock bumper set is a separate catalog prop with its own collision and crush damage.

The renderer exposes a details layer, and the screenshot route discovers one real host per declared detail kind. Use `npm run capture:assets -- --filter=detail:` for layer, support-loss and destruction galleries. Review both `model.png` and `layers/only-details.png`; visibility and stability tests cannot establish artistic quality.

`roof-duct` is a roof-mounted exception within the same detail registry. It requires width 1, an exposed perimeter cell on the top floor, and a flat roof. The selected cell identifies the covering roof panel, whose complete bearing-support set supplies capture damage targets. The duct has a base flashing, vertical exhaust trunk, seams and rain cap. All vertices follow the roof's production hinge/drop transform, and the assembly disappears when its roof panel is gone. It adds no ground collision or independent HP. The diner provides the first host; its authoring recipe preserves the kitchen exhaust.

`dormer` uses the same roof ownership, with a gable roof required instead of a flat roof. It adds a framed window, cheeks, front gable and two small roof planes. The attachment base is sampled on the original covering plane, then the entire assembly follows that panel's hinge and drop. Dormers are decorative attic details, with no additional occupied room or independent collision. The boarding house has two south-facing examples. Author width 1 on the top floor; unsupported roof types or wider mounts are rejected.
