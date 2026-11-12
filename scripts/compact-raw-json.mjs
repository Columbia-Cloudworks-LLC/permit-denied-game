import { readFile } from "node:fs/promises";

/** Authored content that ships as raw JSON text: building packages and regional landmark packages. */
const CONTENT_JSON = /\/src\/world\/(?:data|landmarkData)\/.+\.json$/;

/**
 * The same JSON without indentation. Text that does not parse is returned untouched, so the
 * runtime still reports the malformed file by its path.
 * @param {string} text
 */
export function compactJsonText(text) {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/**
 * A `?raw` import of authored content JSON, as its file path; anything else is null.
 * @param {string} id
 */
export function rawContentJsonPath(id) {
  const [file, query] = id.split("?");
  return query === "raw" && file && CONTENT_JSON.test(file.replaceAll("\\", "/")) ? file : null;
}

/**
 * Authored content JSON is imported as raw text and pretty-printed for review. Production builds
 * ship it compacted, which keeps the `buildings` chunk and the initial payload inside their budgets.
 * @returns {import("vite").Plugin}
 */
export function compactRawJson() {
  return {
    name: "compact-raw-json",
    apply: "build",
    enforce: "pre",
    async load(id) {
      const file = rawContentJsonPath(id);
      if (!file) return null;
      return `export default ${JSON.stringify(compactJsonText(await readFile(file, "utf8")))}`;
    },
  };
}
