# Grain elevator and silo assemblies

The grain elevator combines an ordinary six-level headhouse with two cylindrical bins. Each `silos` definition declares an ID, base rectangle origin (`gx`, `gy`), odd diameter of 5–9 cells, height, minimum surviving supports and a headhouse feed-pipe mount. Bins occupy ground-base sections with empty layouts; no upper occupied rooms may cross their footprint. Their ordinary low roof panels are omitted.

Each cylinder has eight shell-support sectors around its circumference. Damage uses normal structural cell HP, with metal shell material and arc-bounded ground collision boxes. Rendered shell openings follow failed sectors. With the authored minimum of five supports, three losses leave the bin standing and a fourth initiates a 2.4-second controlled drop/flatten. Remaining base sectors fail with the assembly. Sixteen metal panels enter the ordinary debris path at the end.

Bins own separate collapse state, so one can fail without damaging the other or its headhouse. Feed pipes disappear if their headhouse mount fails or the receiving bin starts falling. The building cannot count as fully down until all bins are gone.

The roof layer controls conical lids, walls controls cylindrical shells, and details controls feed pipes. Maximum-floor views clip the shells by elevation. Capture manifests include each silo's phase/progress, and the runner explicitly rejects a silo surviving full damage.

The current collision uses eight sector bounds rather than a general curved rigid body. The controlled animation does not introduce a city-wide physics solver. Heights and dimensions remain authored and are not resized at runtime.
