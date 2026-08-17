/*
  Region: a Builder's self-declared country, and the continent it belongs to.
  Either scopes a Leaderboard; the world is the widest Region (CONTEXT.md).

  A Region is addressed by a `regionSlug`, which is what appears in a URL and in
  a tab: `world`, a continent slug, or a lowercased ISO alpha-2 country code.
  Slugs never collide because no country code is `world` or a continent name.
*/
import { countries, countryByCode } from "./countries";

export type ContinentSlug =
  | "europe"
  | "north-america"
  | "south-america"
  | "asia"
  | "africa"
  | "oceania";

export const continents: { slug: ContinentSlug; name: string }[] = [
  { slug: "europe", name: "Europe" },
  { slug: "north-america", name: "North America" },
  { slug: "south-america", name: "South America" },
  { slug: "asia", name: "Asia" },
  { slug: "africa", name: "Africa" },
  { slug: "oceania", name: "Oceania" },
];

/*
  Country to continent. Follows the common geoscheme: Central America and the
  Caribbean sit in North America, Russia in Europe, the Caucasus and Türkiye in
  Asia. The five polar codes (AQ, BV, GS, HM, TF) have no continent here because
  nobody lives there; a Builder who picks one still appears on the world board
  and on their own country board, just not on a continent board.
*/
const CONTINENT_COUNTRIES: Record<ContinentSlug, string[]> = {
  europe: [
    "AX", "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FO", "FI",
    "FR", "DE", "GI", "GR", "GG", "HU", "IS", "IE", "IM", "IT", "JE", "LV", "LI", "LT", "LU",
    "MT", "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI",
    "ES", "SJ", "SE", "CH", "UA", "GB", "VA",
  ],
  "north-america": [
    "AI", "AG", "AW", "BS", "BB", "BZ", "BM", "BQ", "CA", "KY", "CR", "CU", "CW", "DM", "DO",
    "SV", "GL", "GD", "GP", "GT", "HT", "HN", "JM", "MQ", "MX", "MS", "NI", "PA", "PR", "BL",
    "KN", "LC", "MF", "PM", "VC", "SX", "TT", "TC", "UM", "US", "VG", "VI",
  ],
  "south-america": [
    "AR", "BO", "BR", "CL", "CO", "EC", "FK", "GF", "GY", "PY", "PE", "SR", "UY", "VE",
  ],
  asia: [
    "AF", "AM", "AZ", "BH", "BD", "BT", "IO", "BN", "KH", "CN", "GE", "HK", "IN", "ID", "IR",
    "IQ", "IL", "JP", "JO", "KZ", "KW", "KG", "LA", "LB", "MO", "MY", "MV", "MN", "MM", "NP",
    "KP", "OM", "PK", "PS", "PH", "QA", "SA", "SG", "KR", "LK", "SY", "TW", "TJ", "TH", "TL",
    "TR", "TM", "AE", "UZ", "VN", "YE",
  ],
  africa: [
    "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG", "CD", "CI", "DJ",
    "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG",
    "MW", "ML", "MR", "MU", "YT", "MA", "MZ", "NA", "NE", "NG", "RE", "RW", "SH", "ST", "SN",
    "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "EH", "ZM", "ZW",
  ],
  oceania: [
    "AS", "AU", "CX", "CC", "CK", "FJ", "PF", "GU", "KI", "MH", "FM", "NR", "NC", "NZ", "NU",
    "NF", "MP", "PW", "PG", "PN", "WS", "SB", "TK", "TO", "TV", "VU", "WF",
  ],
};

/** ISO alpha-2 code to continent slug. Codes are uppercase, as in `countries`. */
export const countryContinent: Readonly<Record<string, ContinentSlug>> = Object.fromEntries(
  Object.entries(CONTINENT_COUNTRIES).flatMap(([slug, codes]) =>
    codes.map((code) => [code, slug as ContinentSlug]),
  ),
);

export function continentOf(code: string | null | undefined): ContinentSlug | undefined {
  return code ? countryContinent[code.toUpperCase()] : undefined;
}

/** Where a Leaderboard query looks: the world, one continent, or one country. */
export type Region =
  | { slug: "world"; kind: "world"; name: string }
  | { slug: ContinentSlug; kind: "continent"; name: string; countries: string[] }
  | { slug: string; kind: "country"; name: string; country: string };

export const WORLD: Region = { slug: "world", kind: "world", name: "World" };

const CONTINENT_REGIONS = new Map<string, Region>(
  continents.map((continent) => [
    continent.slug,
    {
      slug: continent.slug,
      kind: "continent" as const,
      name: continent.name,
      countries: CONTINENT_COUNTRIES[continent.slug],
    },
  ]),
);

/** The URL segment for a country Region: the code, lowercased. */
export function regionSlugForCountry(code: string): string {
  return code.toLowerCase();
}

export function countryRegion(code: string): Region | null {
  const country = countryByCode(code);
  if (!country) return null;
  return {
    slug: regionSlugForCountry(country.code),
    kind: "country",
    name: country.name,
    country: country.code,
  };
}

/** Resolves a URL segment to a Region, or null so the route can 404. */
export function regionBySlug(slug: string | null | undefined): Region | null {
  if (!slug) return null;
  const normalized = slug.toLowerCase();
  if (normalized === WORLD.slug) return WORLD;
  const continent = CONTINENT_REGIONS.get(normalized);
  if (continent) return continent;
  return normalized.length === 2 ? countryRegion(normalized.toUpperCase()) : null;
}

/*
  The tab strip: the world, every continent, then countries. Romania leads the
  countries because that is where the crew is, and the viewer's own country
  follows when they have declared one.
*/
export const HOME_COUNTRY = "RO";

export function regionTabs(viewerCountry?: string | null): Region[] {
  const tabs: Region[] = [WORLD, ...CONTINENT_REGIONS.values()];
  const home = countryRegion(HOME_COUNTRY);
  if (home) tabs.push(home);
  const viewer = viewerCountry ? countryRegion(viewerCountry.toUpperCase()) : null;
  if (viewer && viewer.slug !== home?.slug) tabs.push(viewer);
  return tabs;
}

/** Every country code, so a coverage test can assert the map leaves none behind. */
export const allCountryCodes: string[] = countries.map((country) => country.code);
