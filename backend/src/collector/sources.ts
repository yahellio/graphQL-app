/** Адаптеры внешних источников: каждый приводит данные к единому формату. */

export interface QuakeRecord {
  source: 'USGS' | 'EMSC';
  externalId: string;
  time: Date;
  magnitude: number;
  magType: string | null;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  place: string;
  url: string | null;
}

export interface CountryRecord {
  code: string;
  code3: string;
  name: string;
  region: string;
  incomeLevel: string;
  capital: string | null;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  gdpUsd: number | null;
}

export interface QuakeSource {
  name: QuakeRecord['source'];
  fetch(from: Date, to: Date, minMagnitude: number): Promise<QuakeRecord[]>;
}

// ---------- HTTP с таймаутом и повторами ----------

class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON с таймаутом и экспоненциальным backoff.
 * Повторяем только временные ошибки: сеть, таймаут, 429 и 5xx.
 */
export async function fetchJson<T>(url: string, attempts = 4): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: 'application/json', 'User-Agent': 'seismo-lab-collector/1.0' },
      });
      if (res.status === 204) return null; // FDSN: нет событий за период
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (err) {
      const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= attempts) throw err;
      const delay = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
      console.warn(`[collector] ${(err as Error).message}; retry ${attempt}/${attempts - 1} in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
}

const fdsnTime = (d: Date) => d.toISOString().slice(0, 19);
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// ---------- Источник 1: USGS (Геологическая служба США) ----------

interface UsgsResponse {
  features: {
    id: string;
    properties: { mag: number | null; magType: string | null; place: string | null; time: number; url: string | null; title: string };
    geometry: { coordinates: [number, number, number | null] };
  }[];
}

export const usgs: QuakeSource = {
  name: 'USGS',
  async fetch(from, to, minMagnitude) {
    const url =
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventtype=earthquake&orderby=time-asc&limit=20000' +
      `&starttime=${fdsnTime(from)}&endtime=${fdsnTime(to)}&minmagnitude=${minMagnitude}`;
    const data = await fetchJson<UsgsResponse>(url);
    return (data?.features ?? [])
      .filter((f) => f.properties.mag != null)
      .map((f) => ({
        source: 'USGS' as const,
        externalId: f.id,
        time: new Date(f.properties.time),
        magnitude: f.properties.mag!,
        magType: f.properties.magType,
        depthKm: num(f.geometry.coordinates[2]),
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        place: f.properties.place ?? f.properties.title,
        url: f.properties.url,
      }));
  },
};

// ---------- Источник 2: EMSC (Европейско-Средиземноморский сейсмологический центр) ----------

interface EmscResponse {
  features: {
    id: string;
    properties: { time: string; mag: number | null; magtype: string | null; flynn_region: string; lat: number; lon: number; depth: number | null };
  }[];
}

export const emsc: QuakeSource = {
  name: 'EMSC',
  async fetch(from, to, minMagnitude) {
    const url =
      'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20000' +
      `&starttime=${fdsnTime(from)}&endtime=${fdsnTime(to)}&minmagnitude=${minMagnitude}`;
    const data = await fetchJson<EmscResponse>(url);
    return (data?.features ?? [])
      .filter((f) => f.properties.mag != null)
      .map((f) => ({
        source: 'EMSC' as const,
        externalId: f.id,
        time: new Date(f.properties.time),
        magnitude: f.properties.mag!,
        magType: f.properties.magtype,
        depthKm: num(f.properties.depth),
        latitude: f.properties.lat,
        longitude: f.properties.lon,
        place: f.properties.flynn_region,
        url: `https://www.seismicportal.eu/eventdetails.html?unid=${f.id}`,
      }));
  },
};

// ---------- Источник 3: World Bank (страны + индикаторы) ----------

const WORLD_BANK = 'https://api.worldbank.org/v2';

type WorldBankPage<T> = [{ page: number; pages: number }, T[] | null];

/** World Bank отдаёт данные постранично — обходим все страницы. */
async function fetchWorldBank<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await fetchJson<WorldBankPage<T>>(`${WORLD_BANK}${path}${sep}format=json&per_page=300&page=${page}`);
    if (!data) break;
    pages = data[0].pages;
    items.push(...(data[1] ?? []));
  }
  return items;
}

interface WbCountry {
  id: string;
  iso2Code: string;
  name: string;
  region: { id: string; value: string };
  incomeLevel: { value: string };
  capitalCity: string;
  latitude: string;
  longitude: string;
}

interface WbIndicatorValue {
  countryiso3code: string;
  value: number | null;
}

/** Последнее непустое значение индикатора для каждой страны (ключ — ISO3). */
async function indicator(id: string): Promise<Map<string, number>> {
  const rows = await fetchWorldBank<WbIndicatorValue>(`/country/all/indicator/${id}?mrnev=1`);
  return new Map(rows.filter((r) => r.value != null).map((r) => [r.countryiso3code, r.value!]));
}

export async function fetchCountries(): Promise<CountryRecord[]> {
  const [countries, population, gdp] = await Promise.all([
    fetchWorldBank<WbCountry>('/country'),
    indicator('SP.POP.TOTL'),
    indicator('NY.GDP.MKTP.CD'),
  ]);
  return countries
    .filter((c) => c.region.id !== 'NA' && /^[A-Z]{2}$/.test(c.iso2Code)) // отбрасываем агрегаты («World», «Euro area»...)
    .map((c) => ({
      code: c.iso2Code,
      code3: c.id,
      name: c.name,
      region: c.region.value.trim(),
      incomeLevel: c.incomeLevel.value.trim(),
      capital: c.capitalCity || null,
      latitude: num(c.latitude),
      longitude: num(c.longitude),
      population: population.get(c.id) ?? null,
      gdpUsd: gdp.get(c.id) ?? null,
    }));
}
