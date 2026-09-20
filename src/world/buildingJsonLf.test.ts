import { describe, expect, it } from "vitest";

const RAW_BUILDING_TEXT = import.meta.glob<string>(
  ["./data/**/*.building.json", "./data/**/*.layout.json", "./data/**/*.construction.json"],
  { eager: true, query: "?raw", import: "default" },
);

describe("authored building JSON line endings", () => {
  it("stays LF so Windows CI does not inflate the buildings chunk past 650 KiB", () => {
    const crlf = Object.entries(RAW_BUILDING_TEXT)
      .filter(([, text]) => text.includes("\r"))
      .map(([file]) => file);
    expect(crlf).toEqual([]);
  });
});
