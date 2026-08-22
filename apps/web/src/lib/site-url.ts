/*
  Where this deployment lives, in one place.

  Both the metadata base and the share card footers need the site's address, and
  a second hardcoded copy is how a card ends up pointing at a host nobody owns.
  `NEXT_PUBLIC_APP_URL` is the single source: it is what the connect approval
  link is built from too, so the CLI, the browser and the cards all agree.
*/

/** The origin, without a trailing slash. Falls back to dev so tests and `next dev` work unset. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/** Just the host, for the places that show an address rather than link to one. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
