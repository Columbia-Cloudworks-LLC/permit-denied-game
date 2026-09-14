# Privacy and analytics

`/privacy` and `/terms` are independent static Vite entries. The Build Output API routes them before the game fallback. Policy pages load no PixiJS or game world. The game menu, catalog footer, and policy pages expose legal links and Privacy Settings.

`src/privacy/state.ts` owns the terms version, preference keys, and analytics URL/referrer boundary. `privacy.ts` handles native dialogs, session fallback when local storage fails, storage-event synchronization, and Vercel SDK injection. Terms are checked before simulation begins, including direct game links. Their acknowledgment is independent from analytics permission. A material terms change requires updating the HTML date and `TERMS_VERSION`; update the browser test setup accordingly.

Only `adult-allowed` enables optional analytics. There is no birth-date collection, age profile, cookie analytics, identity event, or server-side terms record. This is a self-declaration and browser preference, not verification of identity or parental permission. Decline, missing/corrupt preferences, previews, development, and test maps fail closed. Preferences are browser-local and have no automatic expiration.

Analytics injects only on production hostnames and an allowed page. Use the SDK's supported `/_vercel/insights` routes; Vercel enables them on deployment after dashboard activation. This app builds in GitHub Actions, not through a Vercel build, so it explicitly uses production mode and the documented compatibility endpoints. Deployment verification checks that the script is JavaScript rather than the game fallback.

Automatic route tracking is disabled. Each document produces one sanitized pageview when analytics is first enabled. Changing game seeds or catalog search/frame parameters does not generate pageviews. Custom events use only authored game mode/district/asset IDs and outcome/duration. The vendor's separate external-referrer field is protected by excluding detailed external referrers. All documents set a no-referrer policy for outgoing navigation and requests.

Run events start at the first consented active simulation step, engage once after 60 active seconds, and finish on the game's results transition. Pauses, hidden tabs, test maps and frozen simulation do not contribute. There are no retrospective events after a consent change and no event for simply closing a tab. Sandbox runs have no natural finish; restarts have their own event. No analytics exports or player profiles are maintained by this implementation.

Withdrawal blocks new events immediately and clears SDK events waiting for its script. Already dispatched requests cannot be recalled. Other open tabs synchronize via the browser storage event. `beforeSend` rechecks consent and world eligibility at send time.

Run `node scripts/verify-privacy.mjs` after building. It runs the production bundle with the current Vercel script at an intercepted production origin and intercepts all collection requests. It covers first-play gating, refusal, adult opt-in, all five events, URL redaction, cross-tab withdrawal, storage failures, and mobile geometry. These are browser-emulation checks, not physical-device performance measurements. Existing mobile/debug/catalog regression scripts explicitly seed prior refusal, with the actual first-visit flow covered separately.

Policy changes should reflect the implementation and provider settings. Do not equate Vercel's 24-hour visitor identifier lifetime or dashboard reporting window with deletion of all data. Accounts, payments, ads, uploads, new processors, or materially different analytics require revisiting both notices and consent before launch.

Primary references checked September 13, 2026: [Vercel package](https://vercel.com/docs/analytics/package), [Vercel privacy](https://vercel.com/docs/analytics/privacy-policy), [Vercel pricing](https://vercel.com/docs/analytics/limits-and-pricing), [EDPB lawful processing](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en), [EU consumer contracts](https://europa.eu/youreurope/business/selling-in-eu/consumer-contracts-guarantees/consumer-contracts/index_en.htm).
