/**
 * Which channel this build is running on.
 *
 * Kept separate from `version-handoff.ts` because that module registers window
 * listeners at import time, while this check is pure and has to be usable
 * outside a browser (tests import it directly).
 */

/**
 * Whether a given origin is the beta channel.
 *
 * Beta is served by the Vite dev server, so a dev build identifies it — and
 * also identifies the local development server, where the same diagnostics are
 * wanted. The hostname check then covers a beta host that happens to be serving
 * a built bundle.
 */
export const isBetaChannel = (hostname: string, devBuild: boolean) =>
  devBuild || hostname.startsWith("beta-");

/**
 * `isBetaChannel` for this page. Written defensively because `import.meta.env`
 * is not defined outside of Vite.
 */
export const onBetaChannel = () =>
  isBetaChannel(
    typeof window === "undefined" ? "" : window.location.hostname,
    Boolean(import.meta.env?.DEV),
  );
