/**
 * Job location targeting (post-a-job step 1). A job targets one zone; the employer can hide
 * individual countries inside it. Workers only see and start jobs that include their profile
 * country. Shared by the API (validation, filtering) and the web wizard.
 */

/** ISO 3166-1 alpha-2 → English name. Every country that belongs to a zone. */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AE: 'United Arab Emirates', AF: 'Afghanistan', AL: 'Albania', AR: 'Argentina', AT: 'Austria', AU: 'Australia',
  BA: 'Bosnia and Herzegovina', BD: 'Bangladesh', BE: 'Belgium', BG: 'Bulgaria', BH: 'Bahrain', BO: 'Bolivia',
  BR: 'Brazil', BT: 'Bhutan', BY: 'Belarus', CA: 'Canada', CH: 'Switzerland', CI: 'Côte d’Ivoire', CL: 'Chile',
  CM: 'Cameroon', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia', EG: 'Egypt', ES: 'Spain',
  ET: 'Ethiopia', FI: 'Finland', FR: 'France', GB: 'United Kingdom', GH: 'Ghana', GR: 'Greece', GT: 'Guatemala',
  HK: 'Hong Kong', HN: 'Honduras', HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IN: 'India',
  IQ: 'Iraq', IS: 'Iceland', IT: 'Italy', JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KH: 'Cambodia', KR: 'South Korea',
  KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LK: 'Sri Lanka', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia',
  MA: 'Morocco', MD: 'Moldova', ME: 'Montenegro', MK: 'North Macedonia', MM: 'Myanmar', MT: 'Malta', MV: 'Maldives',
  MX: 'Mexico', MY: 'Malaysia', NG: 'Nigeria', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NZ: 'New Zealand',
  OM: 'Oman', PA: 'Panama', PE: 'Peru', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PT: 'Portugal',
  PY: 'Paraguay', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RW: 'Rwanda', SA: 'Saudi Arabia', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', SN: 'Senegal', TH: 'Thailand', TN: 'Tunisia', TR: 'Türkiye',
  TW: 'Taiwan', TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan',
  VE: 'Venezuela', VN: 'Vietnam', ZA: 'South Africa', ZM: 'Zambia', ZW: 'Zimbabwe',
});

/** Countries sorted by name, for selects (worker profile country, "hide countries"). */
export const COUNTRY_OPTIONS: readonly { value: string; label: string }[] = Object.freeze(
  Object.entries(COUNTRY_NAMES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

export interface JobZone {
  slug: string;
  label: string;
  /** null = every country (International). */
  countries: readonly string[] | null;
}

export const JOB_ZONES: readonly JobZone[] = Object.freeze([
  { slug: 'international', label: 'International', countries: null },
  { slug: 'asia', label: 'Asia', countries: ['BD', 'IN', 'PK', 'NP', 'LK', 'BT', 'MV', 'AF', 'CN', 'JP', 'KR', 'HK', 'TW', 'ID', 'MY', 'PH', 'VN', 'TH', 'SG', 'KH', 'MM', 'KZ', 'UZ'] },
  { slug: 'usa-western', label: 'USA & Western', countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'IE'] },
  { slug: 'africa', label: 'Africa', countries: ['EG', 'MA', 'DZ', 'TN', 'NG', 'GH', 'KE', 'ZA', 'ET', 'TZ', 'UG', 'CM', 'SN', 'CI', 'ZW', 'ZM', 'RW'] },
  { slug: 'europe-west', label: 'Europe West', countries: ['GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'IE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'LU', 'IS', 'GR', 'MT', 'CY'] },
  { slug: 'middle-east', label: 'Middle East', countries: ['AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'JO', 'LB', 'IQ', 'TR'] },
  { slug: 'europe-east', label: 'Europe East', countries: ['PL', 'RO', 'LT', 'LV', 'EE', 'AL', 'SI', 'CZ', 'SK', 'HU', 'BG', 'UA', 'RS', 'HR', 'BA', 'MK', 'MD', 'ME', 'BY'] },
  { slug: 'latin-america', label: 'Latin America', countries: ['BR', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'CR', 'PA', 'GT', 'DO', 'HN'] },
]);

export const DEFAULT_JOB_ZONE = 'international';

export function jobZone(slug: string | null | undefined): JobZone | undefined {
  return JOB_ZONES.find((z) => z.slug === slug);
}

/** Countries an employer can hide for a zone (International → every listed country). */
export function zoneCountries(slug: string): string[] {
  const z = jobZone(slug);
  if (!z) return [];
  return [...(z.countries ?? Object.keys(COUNTRY_NAMES))].sort((a, b) => (COUNTRY_NAMES[a] ?? a).localeCompare(COUNTRY_NAMES[b] ?? b));
}

/** Stored target list for a zone: empty = every country (International). */
export function zoneTargetCountries(slug: string): string[] {
  return [...(jobZone(slug)?.countries ?? [])];
}

/** Can a worker in `country` see/start a job with this targeting? Empty target list = every country. */
export function jobVisibleIn(country: string, t: { target_countries: readonly string[]; excluded_countries: readonly string[] }): boolean {
  const c = country.toUpperCase();
  if (t.excluded_countries.includes(c)) return false;
  return !t.target_countries.length || t.target_countries.includes(c);
}

/** "Asia · 2 countries hidden" / "International". */
export function targetingLabel(zoneSlug: string, excluded: readonly string[]): string {
  const z = jobZone(zoneSlug)?.label ?? 'International';
  return excluded.length ? `${z} · ${excluded.length} ${excluded.length === 1 ? 'country' : 'countries'} hidden` : z;
}
