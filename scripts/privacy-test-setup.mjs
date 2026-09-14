/** Existing game/catalog checks exercise gameplay with a previously recorded
 * refusal. Dedicated privacy checks cover the actual first-visit flow. */
export async function privacyTestSetup(pageOrContext) {
  await pageOrContext.addInitScript(() => {
    try {
      localStorage.setItem('pd.terms', '2026-09-13');
      localStorage.setItem('pd.analytics', 'declined');
    } catch { /* Initial about:blank has no origin storage. */ }
  });
}
