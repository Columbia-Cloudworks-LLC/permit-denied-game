import { describe, expect, it } from "vitest";
import { drivewayPavementColor, drivewayStyle } from "./drivewayStyle";
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
});
