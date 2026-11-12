import { describe, expect, it } from "vitest";
import { drivewayPavementColor, drivewayStyle, lotCover } from "./drivewayStyle";
import type { LotIdentity } from "../structure/types";

describe("driveway style", () => {
  const identities: LotIdentity[] = ["residence", "farm", "shop", "service", "contractor", "utility"];

  it("gives each lot identity a distinct surface or width", () => {
    const signatures = identities.map((id) => {
      const style = drivewayStyle(id);
      return `${style.surface}:${style.width.toFixed(2)}:${style.cover}`;
    });
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(4);
    expect(drivewayStyle("residence").surface).toBe("concrete");
    expect(drivewayStyle("farm").surface).toBe("dirt");
    expect(drivewayStyle("contractor").surface).toBe("gravel");
    expect(drivewayStyle("shop").width).toBeGreaterThan(drivewayStyle("residence").width);
  });

  it("keeps gravel driveway pavement on the historic mesh color", () => {
    expect(drivewayPavementColor("gravel")).toBe(0x5a5248);
    expect(drivewayPavementColor("dirt")).not.toBe(drivewayPavementColor("concrete"));
  });

  it("leaves every temperate style untouched and keeps arid widths and shoulders", () => {
    for (const id of identities) {
      expect(drivewayStyle(id, false)).toEqual(drivewayStyle(id));
      expect(drivewayStyle(id, true).width).toBe(drivewayStyle(id).width);
      expect(drivewayStyle(id, true).shoulder).toBe(drivewayStyle(id).shoulder);
    }
  });

  it("swaps poured residential drives for decomposed granite and caliche in arid climates", () => {
    expect(drivewayStyle("residence", true)).toMatchObject({ surface: "gravel", cover: "gravel" });
    expect(drivewayStyle("farm", true)).toMatchObject({ surface: "dirt", cover: "caliche" });
    expect(drivewayStyle("contractor", true).cover).toBe("caliche");
    expect(drivewayStyle("shop", true)).toEqual(drivewayStyle("shop"));
  });

  it("turns turf and planted beds into xeriscape and gravel only when arid", () => {
    for (const cover of ["grass", "scrub", "planted", "dirt", "gravel", "concrete", "parking"] as const) expect(lotCover(cover, false)).toBe(cover);
    expect(lotCover("grass", true)).toBe("xeriscape");
    expect(lotCover("scrub", true)).toBe("xeriscape");
    expect(lotCover("planted", true)).toBe("gravel");
    expect(lotCover("dirt", true)).toBe("caliche");
    expect(lotCover("parking", true)).toBe("parking");
  });
});
