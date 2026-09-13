# Elevated tank assemblies

An `elevatedTank` building is an open infrastructure frame. It has no rooms, slabs, ordinary roof sections or entrances. Its layout file contains `{"partitions":false,"rooms":[]}`. Each footprint layer contains exactly four corner cells, forming continuous legs.

The supported form uses an odd footprint width/depth from 3–9 cells, 2–6 frame levels, frame construction and a flat roof declaration. `elevatedTank` contains `radius`, `height`, `minimumLegs` (3 or 4), `warningDuration` and `fallDuration`. The validator rejects incompatible rooms, attachments, footprints and core-collapse settings. Dimension overrides are rejected; author another package to change the frame.

The water-tower package is the reference implementation. Leg collision uses square 0.32-unit columns. The tank stays overhead while enough continuous legs remain. Losing support triggers a warning and then controlled tilt/descent, which pulls down the surviving frame and emits tank panels through normal debris simulation. It does not add a ground obstacle under the intact tank or a rigid-body simulation for the falling tank.

The production renderer maps legs and tank sides to the walls layer, the lid to roofs, and bracing/ladder to details. Capture manifests include tank phase, support count and fall progress. Full-damage capture explicitly requires the tank to reach `gone`, in addition to ordinary cell cleanup.
