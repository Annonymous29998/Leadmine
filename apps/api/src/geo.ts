/** Map free-text location → SerpAPI google locale params for worldwide coverage. */

export type GeoHint = {
  /** SerpAPI `location` — Google Uule-style place string */
  location?: string;
  /** Country code for `gl` */
  gl?: string;
  /** Interface language `hl` */
  hl?: string;
  /** google_domain e.g. google.co.uk */
  google_domain?: string;
};

type CountryRule = {
  gl: string;
  hl: string;
  google_domain: string;
  aliases: string[];
};

const COUNTRIES: CountryRule[] = [
  { gl: 'us', hl: 'en', google_domain: 'google.com', aliases: ['usa', 'united states', 'america', 'us'] },
  { gl: 'gb', hl: 'en', google_domain: 'google.co.uk', aliases: ['uk', 'united kingdom', 'britain', 'england', 'scotland', 'wales'] },
  { gl: 'ng', hl: 'en', google_domain: 'google.com.ng', aliases: ['nigeria', 'lagos', 'abuja', 'port harcourt', 'ibadan', 'kano'] },
  { gl: 'gh', hl: 'en', google_domain: 'google.com.gh', aliases: ['ghana', 'accra', 'kumasi'] },
  { gl: 'ke', hl: 'en', google_domain: 'google.co.ke', aliases: ['kenya', 'nairobi', 'mombasa'] },
  { gl: 'za', hl: 'en', google_domain: 'google.co.za', aliases: ['south africa', 'johannesburg', 'cape town', 'durban', 'pretoria'] },
  { gl: 'ca', hl: 'en', google_domain: 'google.ca', aliases: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa'] },
  { gl: 'au', hl: 'en', google_domain: 'google.com.au', aliases: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth'] },
  { gl: 'in', hl: 'en', google_domain: 'google.co.in', aliases: ['india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'pune'] },
  { gl: 'ae', hl: 'en', google_domain: 'google.ae', aliases: ['uae', 'dubai', 'abu dhabi', 'united arab emirates'] },
  { gl: 'sa', hl: 'ar', google_domain: 'google.com.sa', aliases: ['saudi', 'saudi arabia', 'riyadh', 'jeddah'] },
  { gl: 'eg', hl: 'ar', google_domain: 'google.com.eg', aliases: ['egypt', 'cairo', 'alexandria'] },
  { gl: 'de', hl: 'de', google_domain: 'google.de', aliases: ['germany', 'deutschland', 'berlin', 'munich', 'hamburg', 'frankfurt'] },
  { gl: 'fr', hl: 'fr', google_domain: 'google.fr', aliases: ['france', 'paris', 'lyon', 'marseille'] },
  { gl: 'es', hl: 'es', google_domain: 'google.es', aliases: ['spain', 'madrid', 'barcelona', 'valencia'] },
  { gl: 'it', hl: 'it', google_domain: 'google.it', aliases: ['italy', 'italia', 'rome', 'milan', 'naples'] },
  { gl: 'nl', hl: 'nl', google_domain: 'google.nl', aliases: ['netherlands', 'holland', 'amsterdam', 'rotterdam'] },
  { gl: 'be', hl: 'nl', google_domain: 'google.be', aliases: ['belgium', 'brussels', 'antwerp'] },
  { gl: 'ie', hl: 'en', google_domain: 'google.ie', aliases: ['ireland', 'dublin', 'cork'] },
  { gl: 'pt', hl: 'pt', google_domain: 'google.pt', aliases: ['portugal', 'lisbon', 'porto'] },
  { gl: 'br', hl: 'pt', google_domain: 'google.com.br', aliases: ['brazil', 'brasil', 'sao paulo', 'são paulo', 'rio de janeiro', 'brasilia'] },
  { gl: 'mx', hl: 'es', google_domain: 'google.com.mx', aliases: ['mexico', 'méxico', 'mexico city', 'guadalajara', 'monterrey'] },
  { gl: 'ar', hl: 'es', google_domain: 'google.com.ar', aliases: ['argentina', 'buenos aires'] },
  { gl: 'cl', hl: 'es', google_domain: 'google.cl', aliases: ['chile', 'santiago'] },
  { gl: 'co', hl: 'es', google_domain: 'google.com.co', aliases: ['colombia', 'bogota', 'bogotá', 'medellin'] },
  { gl: 'pe', hl: 'es', google_domain: 'google.com.pe', aliases: ['peru', 'lima'] },
  { gl: 'jp', hl: 'ja', google_domain: 'google.co.jp', aliases: ['japan', 'tokyo', 'osaka', 'kyoto'] },
  { gl: 'kr', hl: 'ko', google_domain: 'google.co.kr', aliases: ['korea', 'south korea', 'seoul', 'busan'] },
  { gl: 'cn', hl: 'zh-CN', google_domain: 'google.com.hk', aliases: ['china', 'beijing', 'shanghai', 'shenzhen', 'hong kong'] },
  { gl: 'sg', hl: 'en', google_domain: 'google.com.sg', aliases: ['singapore'] },
  { gl: 'my', hl: 'en', google_domain: 'google.com.my', aliases: ['malaysia', 'kuala lumpur'] },
  { gl: 'id', hl: 'id', google_domain: 'google.co.id', aliases: ['indonesia', 'jakarta', 'bali', 'surabaya'] },
  { gl: 'ph', hl: 'en', google_domain: 'google.com.ph', aliases: ['philippines', 'manila', 'cebu'] },
  { gl: 'th', hl: 'th', google_domain: 'google.co.th', aliases: ['thailand', 'bangkok'] },
  { gl: 'vn', hl: 'vi', google_domain: 'google.com.vn', aliases: ['vietnam', 'hanoi', 'ho chi minh', 'saigon'] },
  { gl: 'pk', hl: 'en', google_domain: 'google.com.pk', aliases: ['pakistan', 'karachi', 'lahore', 'islamabad'] },
  { gl: 'bd', hl: 'en', google_domain: 'google.com.bd', aliases: ['bangladesh', 'dhaka'] },
  { gl: 'tr', hl: 'tr', google_domain: 'google.com.tr', aliases: ['turkey', 'türkiye', 'istanbul', 'ankara'] },
  { gl: 'pl', hl: 'pl', google_domain: 'google.pl', aliases: ['poland', 'warsaw', 'krakow', 'kraków'] },
  { gl: 'se', hl: 'sv', google_domain: 'google.se', aliases: ['sweden', 'stockholm'] },
  { gl: 'no', hl: 'no', google_domain: 'google.no', aliases: ['norway', 'oslo'] },
  { gl: 'dk', hl: 'da', google_domain: 'google.dk', aliases: ['denmark', 'copenhagen'] },
  { gl: 'fi', hl: 'fi', google_domain: 'google.fi', aliases: ['finland', 'helsinki'] },
  { gl: 'ch', hl: 'de', google_domain: 'google.ch', aliases: ['switzerland', 'zurich', 'geneva'] },
  { gl: 'at', hl: 'de', google_domain: 'google.at', aliases: ['austria', 'vienna'] },
  { gl: 'nz', hl: 'en', google_domain: 'google.co.nz', aliases: ['new zealand', 'auckland', 'wellington'] },
  { gl: 'il', hl: 'iw', google_domain: 'google.co.il', aliases: ['israel', 'tel aviv', 'jerusalem'] },
  { gl: 'ru', hl: 'ru', google_domain: 'google.ru', aliases: ['russia', 'moscow', 'saint petersburg', 'st petersburg'] },
  { gl: 'ua', hl: 'uk', google_domain: 'google.com.ua', aliases: ['ukraine', 'kyiv', 'kiev'] },
  { gl: 'tz', hl: 'en', google_domain: 'google.co.tz', aliases: ['tanzania', 'dar es salaam'] },
  { gl: 'ug', hl: 'en', google_domain: 'google.co.ug', aliases: ['uganda', 'kampala'] },
  { gl: 'rw', hl: 'en', google_domain: 'google.rw', aliases: ['rwanda', 'kigali'] },
  { gl: 'et', hl: 'en', google_domain: 'google.com.et', aliases: ['ethiopia', 'addis ababa'] },
  { gl: 'ma', hl: 'fr', google_domain: 'google.co.ma', aliases: ['morocco', 'casablanca', 'rabat'] },
];

/** US state / major city hints → still gl=us with precise location string */
const US_PLACES = [
  'new york', 'nyc', 'los angeles', 'la', 'chicago', 'houston', 'dallas', 'austin',
  'san francisco', 'seattle', 'boston', 'miami', 'atlanta', 'denver', 'phoenix',
  'philadelphia', 'san diego', 'portland', 'vegas', 'las vegas', 'texas', 'california',
  'florida', 'washington', 'ohio', 'georgia', 'michigan',
];

const BARE_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io', 'co', 'uk',
  'us', 'ng', 'za', 'au', 'ca', 'in', 'de', 'fr', 'es', 'it', 'br', 'mx', 'jp', 'cn',
]);

export function normalizeLocationText(location: string): string {
  return location.trim().replace(/\s+/g, ' ');
}

export function resolveGeo(location: string): GeoHint {
  const raw = normalizeLocationText(location);
  if (!raw) return {};

  const lower = raw.toLowerCase();

  for (const rule of COUNTRIES) {
    for (const alias of rule.aliases) {
      if (lower === alias || lower.includes(alias)) {
        return {
          location: raw,
          gl: rule.gl,
          hl: rule.hl,
          google_domain: rule.google_domain,
        };
      }
    }
  }

  if (US_PLACES.some((p) => lower === p || lower.includes(p))) {
    return {
      location: raw,
      gl: 'us',
      hl: 'en',
      google_domain: 'google.com',
    };
  }

  // Unknown place — still pass as SerpAPI location for Google geo bias
  return { location: raw, hl: 'en' };
}

export function isBareTld(domain: string): boolean {
  return BARE_TLDS.has(domain.toLowerCase()) || !domain.includes('.');
}

/** Quote multi-word locations for search queries. */
export function quoteIfNeeded(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/\s/.test(t) && !/^".*"$/.test(t)) return `"${t}"`;
  return t;
}
