import { Container, Graphics, Text } from "pixi.js";
import { expect, it, vi } from "vitest";
import { createTown } from "../world/town";
import { clearNhoodOverlay, drawNhoodOverlay } from "./nhoodOverlay";

function spyPixiAddChildWarnings(): { messages: () => string[]; restore: () => void } {
  const messages: string[] = [];
  const capture = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(capture);
  const group = vi.spyOn(console, "groupCollapsed").mockImplementation(capture);
  return {
    messages: () => messages.filter((message) => /addChild: Only Containers will be allowed to add children/i.test(message)),
    restore: () => {
      warn.mockRestore();
      group.mockRestore();
    },
  };
}

it("parents neighborhood labels on a Container and stays silent on Pixi addChild deprecation", () => {
  const warnings = spyPixiAddChildWarnings();
  const layer = new Container();
  const g = new Graphics();
  layer.addChild(g);
  const town = createTown({ district: "d10", seed: 19 });
  drawNhoodOverlay(g, layer, town);
  expect(g.children).toHaveLength(0);
  expect(layer.children[0]).toBe(g);
  expect(layer.children.some((child) => child instanceof Text)).toBe(true);
  for (const child of layer.children) {
    if (child instanceof Text) expect(child.parent).toBe(layer);
  }
  expect(warnings.messages()).toEqual([]);
  clearNhoodOverlay(g, layer);
  expect(layer.children).toEqual([g]);
  expect(g.children).toHaveLength(0);
  warnings.restore();
  layer.destroy({ children: true });
});
