import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compactJsonText, compactRawJson, rawContentJsonPath } from "./compact-raw-json.mjs";

describe("raw content JSON compaction", () => {
  it("drops indentation and keeps the data", () => {
    const pretty = '{\n  "id": "ranch",\n  "rooms": [\n    { "w": 0.5 }\n  ]\n}\n';
    const compact = compactJsonText(pretty);
    assert.equal(compact, '{"id":"ranch","rooms":[{"w":0.5}]}');
    assert.deepEqual(JSON.parse(compact), JSON.parse(pretty));
  });

  it("passes malformed text through so the runtime can name the file", () => {
    assert.equal(compactJsonText('{ "id": '), '{ "id": ');
  });

  it("only claims raw imports of authored content", () => {
    assert.equal(rawContentJsonPath("/repo/src/world/data/buildings/ranch/main.building.json?raw"), "/repo/src/world/data/buildings/ranch/main.building.json");
    assert.equal(rawContentJsonPath("C:\\repo\\src\\world\\landmarkData\\a\\main.layout.json?raw"), "C:\\repo\\src\\world\\landmarkData\\a\\main.layout.json");
    assert.equal(rawContentJsonPath("/repo/src/world/data/vehicles/dozer.vehicle.json"), null);
    assert.equal(rawContentJsonPath("/repo/public/terrain/ground.json?raw"), null);
    assert.equal(rawContentJsonPath("/repo/src/render/thirdPartyNotices.txt?raw"), null);
  });

  it("is a build-only plugin that loads ahead of the raw loader", async () => {
    const plugin = compactRawJson();
    assert.equal(plugin.apply, "build");
    assert.equal(plugin.enforce, "pre");
    const load = /** @type {(id: string) => Promise<string | null>} */ (plugin.load);
    assert.equal(await load("/repo/src/main.ts"), null);
    const file = fileURLToPath(new URL("../src/world/data/shared/construction/timber-house.construction.json", import.meta.url));
    const source = await load(file + "?raw");
    assert.match(String(source), /^export default "\{/);
    assert.doesNotMatch(String(source), /\\n/);
  });
});
