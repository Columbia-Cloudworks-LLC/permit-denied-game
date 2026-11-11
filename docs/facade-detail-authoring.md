# Mounted facade details

Building packages may declare `facadeDetails` alongside their roof and feature settings:

```json
"facadeDetails": [
  { "id": "shop-sign", "kind": "signboard", "floor": 0,
    "gx": 1, "gy": 5, "side": "south", "width": 3, "text": "BAKERY" }
]
```

Coordinates are integer cells in the complete building footprint. Width is 1–4 cells along the selected south or east frontage. Every cell in that span must exist and have an exposed outward face; all are required mounting points. IDs are unique within the building. Optional lettering accepts uppercase A–Z, digits and spaces, up to 16 characters.

Supported kinds are `signboard`, `marquee`, `clock-face`, `roll-up-door`, `porch`, `fire-escape`, `entry-steps` and `display-glazing`, plus the roof-mounted `roof-duct`, `dormer` and `rooftop-sign` described below. Porches, shutters and steps are ground-floor details. Fire escapes require an upper floor. Clock faces are static. Marquees have projecting brackets, a canopy, lettering and a light strip.

These attachments share the mounting wall's controlled failure and vanish with its debris when a required mount is gone. Display glazing additionally uses explicit glass cladding HP on each mount: panes break before the bearing frame and emit glass debris. Broken panes expose a dark frame opening; they do not remove the supporting wall's collision. Other details have no separate HP or collision. Steps leave entrance collision unchanged; fire escapes provide no traversal. The outdoor loading-dock bumper set is a separate catalog prop with its own collision and crush damage.

The renderer exposes a details layer, and the screenshot route discovers one real host per declared detail kind. Spawn a host from the debug binder and toggle the details layer to review it; visibility and stability tests cannot establish artistic quality.

`roof-duct` is a roof-mounted exception within the same detail registry. It requires width 1, an exposed perimeter cell on the top floor, and a flat roof. The selected cell identifies the covering roof panel, whose complete bearing-support set supplies capture damage targets. The duct has a base flashing, vertical exhaust trunk, seams and rain cap. All vertices follow the roof's production hinge/drop transform, and the assembly disappears when its roof panel is gone. It adds no ground collision or independent HP. The diner provides the first host; its authoring recipe preserves the kitchen exhaust.

`rooftop-sign` is the third roof-mounted kind: a lit sign cabinet on steel struts at the roof edge. It needs a flat roof (a `canopy` building such as `service-station-canopy` qualifies), the top floor, and width 1–3 along an exposed south or east perimeter span. It follows the first covered panel's hinge/drop transform and disappears as soon as any panel under its span is gone. No collision, no HP of its own.

**Sign colours.** `signboard`, `marquee` and `rooftop-sign` accept optional `faceColor` (panel), `trimColor` (frame or cabinet) and `textColor` (lettering) as integers 0–16777215 (JSON has no hex literals). Omitted colours keep each kind's default. A package may also set a top-level `fasciaColor`, which paints the eave band of flat and canopy roofs and the storefront awning; the roof's underside keeps its own colour. Code that stamps any of these on a live `Building` (regional brand skins, `src/world/regionalBrands.ts`) must replace `facadeDetails` rather than mutate the shared definition, and must bump `building.visualRevision`.

`dormer` uses the same roof ownership, with a gable roof required instead of a flat roof. It adds a framed window, cheeks, front gable and two small roof planes. The attachment base is sampled on the original covering plane, then the entire assembly follows that panel's hinge and drop. Dormers are decorative attic details, with no additional occupied room or independent collision. The boarding house has two south-facing examples. Author width 1 on the top floor; unsupported roof types or wider mounts are rejected.
