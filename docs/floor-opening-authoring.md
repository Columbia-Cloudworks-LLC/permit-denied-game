# Double-height spaces

`floorVoids` is an optional building-package array of `{floor, x, y, w, d}` rectangles in integer cells. It removes physical upper slabs, not building-envelope occupancy. Floor 0 cannot be removed. Rectangles must stay inside occupied footprint cells, and authoring validation rejects furniture overlapping an opening on that floor.

The theater is the reference: its upper auditorium section retains perimeter walls and roof coverage but has an empty layout and one full-section floor opening. The ground-level screen and seats occupy a two-story volume; the lobby remains one story.

Floor records marked `void` remain only as envelope references for roof compilation. The floor index excludes them, so they are neither drawn nor available as fixture supports. Structural stepping creates no slab debris or mass for them and ignores them when deciding whether demolition is complete. Roof generation and roof coverage validation still see the occupied envelope. Existing buildings without openings are unchanged.

Core-collapse and elevated-tank assemblies cannot combine with these openings. Their specialized geometry and mass models require explicit support before that combination can be authored.
