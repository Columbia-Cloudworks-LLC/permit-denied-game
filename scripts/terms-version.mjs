import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/privacy/state.ts", import.meta.url), "utf8");
const match = source.match(/export const TERMS_VERSION = '([^']+)'/);
if (!match) throw new Error("TERMS_VERSION missing from src/privacy/state.ts");

/** Authoritative consent version, read from `src/privacy/state.ts`. */
export const TERMS_VERSION = match[1];
export const TERMS_KEY = "pd.terms";
export const ANALYTICS_KEY = "pd.analytics";
