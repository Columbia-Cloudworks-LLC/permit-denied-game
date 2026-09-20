import { injectConsent } from "./capture/harness.mjs";

/** Existing game/catalog checks exercise gameplay with a previously recorded
 * refusal. Dedicated privacy checks cover the actual first-visit flow. */
export async function privacyTestSetup(pageOrContext) {
  await injectConsent(pageOrContext, { analytics: "declined" });
}
