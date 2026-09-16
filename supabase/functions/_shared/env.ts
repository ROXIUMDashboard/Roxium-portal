// ============================================================
// Environment resolution for Edge Functions.
//
// Five functions used to read `SITE_URL` with `|| "https://roxium.com"`. On a
// STAGING project that is a trap: an unset secret would silently send staging
// invite emails, OAuth callbacks and digest links to the live customer site.
//
// It was also simply WRONG for production once the portal moved to
// roxiumstudio.com — every invitation and password-reset link built from the
// default pointed at the corporate domain instead of the portal.
//
// siteUrl() keeps production behaviour byte-for-byte identical and FAILS CLOSED
// anywhere else. Set APP_ENV=staging as an edge secret on the staging project.
// ============================================================

export type AppEnv = "production" | "staging";

/** APP_ENV secret; defaults to "production" so the live project is unaffected. */
export function appEnv(): AppEnv {
  const v = (Deno.env.get("APP_ENV") || "production").toLowerCase();
  if (v !== "production" && v !== "staging") {
    throw new Error(`APP_ENV must be "production" or "staging" (got "${v}")`);
  }
  return v;
}

export function isProduction(): boolean {
  return appEnv() === "production";
}

/**
 * The public origin this deployment belongs to, with no trailing slash.
 * production + SITE_URL unset -> "https://roxiumstudio.com" (the live portal)
 * staging    + SITE_URL unset -> throws, rather than linking to the live site
 *
 * SET `SITE_URL` EXPLICITLY ON BOTH PROJECTS. The default exists so an
 * unconfigured production project still builds usable links, not so it can be
 * relied on: if the portal host ever moves again, an explicit secret is the only
 * thing that moves with it. See docs/ENVIRONMENTS.md.
 */
export function siteUrl(): string {
  const raw = (Deno.env.get("SITE_URL") || "").trim().replace(/\/+$/, "");
  if (raw) return raw;
  if (appEnv() === "staging") {
    throw new Error(
      "SITE_URL is not set on this staging project. Refusing to fall back to the " +
        "production site — set the SITE_URL edge secret (see docs/EXTERNAL_SETUP.md).",
    );
  }
  return "https://roxiumstudio.com";
}

/** The portal app lives at <site>/portal/ ; the site root is the marketing page. */
export function portalOrigin(): string {
  return siteUrl() + "/portal/";
}
