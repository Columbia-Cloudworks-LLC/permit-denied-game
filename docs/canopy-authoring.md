# Supported open canopies

The `canopy` building field declares 4–8 distinct `{x,y}` column cells. Use one floor, a flat roof, an unpartitioned empty layout covering the roof footprint, and no entrance panels. Dimensions remain authored; runtime dimension overrides are rejected.

Only declared columns become live structural cells. They have narrow 0.32-square collision boxes, no cladding or facade windows, and normal column damage/debris. Ground tiles provide the forecourt slab. Roof panels retain the footprint and use the declared columns as their bearing supports; ordinary roof sag, failure and debris apply.

The service-station canopy is D11, registered as a building package so the yard and screenshot workflow discover it automatically. It sits over four existing fuel pumps in S05. Site overlap validation uses the four column volumes and overhead roof clearance for canopies; ordinary buildings retain their full occupied volume. Equipment that intersects a column or reaches the roof is rejected.

The renderer draws each intact column from its collision box and uses normal falling-cell and roof rendering during destruction. Canopies have no enclosed wall spans or decorative wall stubs. Roofs, columns and forecourt tiles follow the existing roofs, walls and floors visibility layers respectively.
