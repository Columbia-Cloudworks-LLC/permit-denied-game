import { describe, expect, it } from "vitest";
import { cashAnchor, CashPopups, POPUP_SECONDS } from "./cashPopups";

describe("cash popups", () => {
  it("merges nearby credits, stacks distant ones, and releases them after the fade", () => {
    const popups = new CashPopups();
    popups.credit(12, 10, 10, 1);
    popups.credit(8.5, 11, 10, 1);
    popups.credit(30, 40, 40, 2);
    popups.credit(0, 60, 60, 1);
    popups.draw(0.1, 1);
    expect(popups.amounts()).toEqual([20, 30]);
    expect(popups.root.children.map((c) => (c as unknown as { text: string }).text)).toEqual(["+$20", "+$30"]);
    popups.draw(POPUP_SECONDS, 1);
    expect(popups.count).toBe(0);
    expect(popups.root.children).toHaveLength(0);
  });

  it("anchors on the paying event, else the latest damage", () => {
    expect(cashAnchor([
      { kind: "breach", x: 1, y: 1, z: 1, mag: 1, cash: 5 },
      { kind: "chip", x: 2, y: 2, z: 0, mag: 1 },
    ])).toMatchObject({ x: 1, y: 1 });
    expect(cashAnchor([{ kind: "chip", x: 2, y: 2, z: 0, mag: 1 }, { kind: "scrape", x: 3, y: 3, z: 0, mag: 1 }])).toMatchObject({ x: 2 });
    expect(cashAnchor([{ kind: "scrape", x: 3, y: 3, z: 0, mag: 1 }])).toBeUndefined();
  });
});
