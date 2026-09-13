# Cloudflare business-account setup

The checked-in `scripts/catalog/cloudflare.json` pins operations to business account `d24832efce35cd4904cde1c3b7c5d04a`. It selects `permit-denied-catalog` for public objects, `permit-denied-catalog-cache` for private evidence, and `https://assets.permitdenied.app` for delivery.

## Current verified state — 2026-09-13

Wrangler login succeeded as `nicholas.king@columbiacloudworks.com`. The visible account is `Nicholas.king@columbiacloudworks.com's Account`, with the ID above. Credentials are encrypted at Wrangler's normal user configuration location; the encryption key is in Windows Credential Manager. No token is stored in the repository.

The login has account/user/zone read scopes. After R2 enrollment and separate provisioning authorization, both Standard buckets were created in the default jurisdiction, and read-only CORS was configured on the gallery bucket. S3 credentials passed write, read, metadata, and deduplication checks in both buckets. The two publishing credentials are installed as encrypted GitHub Actions secrets; the provisioning token remains local and ignored by Git.

Vercel CLI authentication and the complete five-record DNS API export are verified. The Cloudflare free zone was created in the business dashboard, with matching CAA records and DNS-only CNAME equivalents of Vercel's apex/wildcard ALIAS records. Assigned nameservers are `dee.ns.cloudflare.com` and `elliott.ns.cloudflare.com`; direct queries resolve the preserved Vercel routes. The original public delegation pointed to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`. A validating Google DNS query reports no parent DS record. The original export and rollback preflight are saved under ignored `artifacts/cloudflare/`.

Registrar delegation is now updated: IONOS API and Google public DNS both report the assigned Cloudflare nameservers, and the business dashboard reports the zone active. The Vercel zone remains intact for rollback. No parent DS existed before migration, and none has been added during the delegation transition; enable DNSSEC only after old delegation caches have expired.

The public R2 hostname is connected with active ownership and TLS, minimum TLS 1.2. Both buckets have `r2.dev` disabled; the private cache bucket has no custom domain or CORS policy. The active `Immutable asset catalog` cache rule matches only `assets.permitdenied.app`, makes responses eligible for caching, and respects origin cache headers for edge and browser TTLs. Live JSON delivery returned HTTP 200, the immutable cache header, wildcard read-only CORS, and a subsequent Cloudflare cache HIT. The game continued returning HTTP 200. Account-wide monthly spend notifications at $5 and $20 go to the business billing contact; these do not cap usage.

IONOS configuration is stored in GitHub organization variables `IONOS_API_KEY_NAME` and `IONOS_API_PUBLIC_PREFIX`, and organization secret `IONOS_API_SECRET`, initially accessible only to `permit-denied-game`. Ordinary game and catalog jobs do not receive registrar credentials. Add selected repositories explicitly when reusing this configuration.

The earlier read-only Wrangler grant does not enumerate the newly created zone; use the authenticated business dashboard as the setup authority until API access is refreshed. The local R2 provisioning token can manage bucket settings but cannot read zone configuration. Node DNS resolver errors are recorded separately and are not evidence of a domain outage.

`node scripts/cloudflare-status.mjs` checks account-zone/R2 readiness using Wrangler credentials captured only in process memory. It never prints tokens. Its non-secret report goes under ignored `artifacts/cloudflare/`.

## Provisioning and credentials

1. Enable R2 in the business account if it is not enabled. Complete any required billing enrollment directly in Cloudflare.
2. Use a separate, temporary business-account provisioning API token with Workers R2 Storage Write and the necessary zone read access. Keep it in local `.env.local` as `CLOUDFLARE_API_TOKEN`, never in chat or source control.
3. Review `node scripts/cloudflare-provision.mjs` (dry-run). Apply the named Standard buckets and public read-only CORS with `node --env-file=.env.local scripts/cloudflare-provision.mjs --apply`. This does not change nameservers or make the cache bucket public.
4. After the zone migration below is complete, attach the public hostname with `node --env-file=.env.local scripts/cloudflare-provision.mjs --apply --attach-domain`. The script requires an active zone in the pinned business account.
5. Keep `r2.dev` disabled for both buckets. The cache bucket must have no public custom domain, no public-development access, and no browser CORS policy. Confirm those settings in the dashboard.
6. Create an R2 S3-compatible Object Read & Write credential restricted to these two buckets. Store its Access Key ID and Secret Access Key in the GitHub repository secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. The account ID and bucket names are public configuration. The provisioning API token is not a publishing credential and must not be passed to CI.

Official references: [R2 API permissions](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/), [custom-domain delivery](https://developers.cloudflare.com/r2/buckets/public-buckets/), and [CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## DNS migration procedure and rollback

Export the full authoritative zone from Vercel using its dashboard or an authorized DNS-management credential. Public DNS queries and Cloudflare's scan cannot enumerate every record; neither is a substitute for the export. Preserve the original export under ignored `artifacts/cloudflare/` and inventory A/AAAA/CNAME, MX, TXT (SPF/DKIM/DMARC and verification), CAA, SRV, wildcard, and any delegated subdomain records.

Add `permitdenied.app` to the pinned business account as a full DNS zone. Import the reviewed records and compare every record against the Vercel export. Keep game apex and `www` records DNS-only, using their existing Vercel values. Preserve mail and validation records. Do not repoint the game to a Worker or Pages project.

Inspect the registrar's DS records and current DNSSEC state. If a DS record exists, remove it at IONOS and wait for its prior TTL before changing authoritative nameservers; a DS mismatch can make the domain fail validation. Retain the original DNSSEC/DS details with the rollback record. Do not infer DNSSEC readiness from an empty or failed resolver response.

Query Cloudflare's assigned nameservers directly and compare important records, including mail. Only after the full-zone comparison passes, change the nameservers at IONOS to the values assigned to this exact zone. Keep the Vercel DNS zone intact. Verify multiple resolvers, game HTTPS, certificate issuance, email records, and the R2 hostname. Re-enable DNSSEC in Cloudflare and publish its new DS at IONOS after stable delegation is confirmed.

Rollback: restore `ns1.vercel-dns.com` and `ns2.vercel-dns.com` at IONOS while the original Vercel zone remains intact. Remove an incompatible Cloudflare DS before returning to the old delegation; restore the old DNSSEC configuration only once its zone is authoritative again. Account for DNS TTLs rather than expecting an instant rollback.

## Caching and cost notifications

Create a Cache Rule restricted to hostname `assets.permitdenied.app`, making its static JSON and WebP files eligible for caching and honoring origin cache headers. All published object URLs are content-hashed and immutable. Public JSON uses wildcard read-only CORS because internal previews have varying origins; no browser write access is granted.

In the business account's Billing → Billable usage → Budget alerts, configure an R2 spend alert at $5/month and a second alert at $20/month, delivered to the business billing contact. These are notifications, not service or asset-count caps. Account-wide alerts include other business projects if R2-specific filtering is unavailable. Review both stored bytes and operation counts; free egress does not mean unlimited free requests. Do not add other recipients without authorization. [Budget alert documentation](https://developers.cloudflare.com/billing/manage/budget-alerts/)

After credentials and DNS are ready, release through the existing PR/CI process. Do not use local partial capture folders or synthetic test fixtures as production coverage evidence.
