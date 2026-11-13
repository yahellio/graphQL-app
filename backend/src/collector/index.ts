import client from 'prom-client';
import { pool } from '../shared/db';
import { registry, serveMetrics } from '../shared/metrics';
import { CountryMatcher } from './geo';
import { emsc, fetchCountries, usgs, type CountryRecord, type QuakeRecord, type QuakeSource } from './sources';

// Первый запуск грузит историю за COLLECT_DAYS дней, дальше каждые
// COLLECT_INTERVAL_MINUTES догружаются только новые события.

const COLLECT_DAYS = Number(process.env.COLLECT_DAYS ?? 180);
const CHUNK_DAYS = 15; // у API лимит 20 000 событий на запрос, поэтому грузим по 15 дней
const MIN_MAGNITUDE = Number(process.env.MIN_MAGNITUDE ?? 3);
const INTERVAL_MS = Number(process.env.COLLECT_INTERVAL_MINUTES ?? 30) * 60_000;
const RETRY_MS = 60_000;
const DAY_MS = 86_400_000;

const SOURCES: QuakeSource[] = [usgs, emsc];

const recordsCollected = new client.Counter({
  name: 'collector_records_total',
  help: 'Записей получено из источника',
  labelNames: ['source'],
  registers: [registry],
});
const runs = new client.Counter({
  name: 'collector_runs_total',
  help: 'Запуски сбора по источникам',
  labelNames: ['source', 'status'],
  registers: [registry],
});
const lastSuccess = new client.Gauge({
  name: 'collector_last_success_timestamp_seconds',
  help: 'Время последнего успешного сбора',
  labelNames: ['source'],
  registers: [registry],
});

// Пачка строк вставляется одним запросом через unnest; повторный сбор обновляет запись, а не дублирует.
async function upsertCountries(rows: CountryRecord[]): Promise<void> {
  const col = <K extends keyof CountryRecord>(k: K) => rows.map((r) => r[k]);
  await pool.query(
    `INSERT INTO countries (code, code3, name, region, income_level, capital, latitude, longitude, population, gdp_usd)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                          $7::float8[], $8::float8[], $9::bigint[], $10::float8[])
     ON CONFLICT (code) DO UPDATE SET
       code3 = EXCLUDED.code3, name = EXCLUDED.name, region = EXCLUDED.region, income_level = EXCLUDED.income_level,
       capital = EXCLUDED.capital, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
       population = EXCLUDED.population, gdp_usd = EXCLUDED.gdp_usd, updated_at = now()`,
    [
      col('code'), col('code3'), col('name'), col('region'), col('incomeLevel'), col('capital'),
      col('latitude'), col('longitude'), col('population'), col('gdpUsd'),
    ],
  );
}

async function upsertQuakes(rows: (QuakeRecord & { countryCode: string | null })[]): Promise<void> {
  if (!rows.length) return;
  const col = <K extends keyof (typeof rows)[number]>(k: K) => rows.map((r) => r[k]);
  await pool.query(
    `INSERT INTO quakes (source, external_id, time, magnitude, mag_type, depth_km, latitude, longitude, place, url, country_code)
     SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::float8[], $5::text[], $6::float8[],
                          $7::float8[], $8::float8[], $9::text[], $10::text[], $11::text[])
     ON CONFLICT (source, external_id) DO UPDATE SET
       time = EXCLUDED.time, magnitude = EXCLUDED.magnitude, mag_type = EXCLUDED.mag_type, depth_km = EXCLUDED.depth_km,
       latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, place = EXCLUDED.place, url = EXCLUDED.url,
       country_code = EXCLUDED.country_code, updated_at = now()`,
    [
      col('source'), col('externalId'), col('time'), col('magnitude'), col('magType'), col('depthKm'),
      col('latitude'), col('longitude'), col('place'), col('url'), col('countryCode'),
    ],
  );
}

// Если World Bank недоступен, берём страны, которые уже есть в базе.
async function collectCountries(): Promise<CountryMatcher> {
  try {
    const countries = await fetchCountries();
    await upsertCountries(countries);
    recordsCollected.inc({ source: 'WORLD_BANK' }, countries.length);
    runs.inc({ source: 'WORLD_BANK', status: 'ok' });
    lastSuccess.setToCurrentTime({ source: 'WORLD_BANK' });
    console.log(`[collector] WORLD_BANK: ${countries.length} countries`);
  } catch (err) {
    runs.inc({ source: 'WORLD_BANK', status: 'error' });
    console.error('[collector] WORLD_BANK failed, using countries from DB:', (err as Error).message);
  }
  const { rows } = await pool.query<{ code: string; name: string }>('SELECT code, name FROM countries');
  return new CountryMatcher(rows);
}

async function collectQuakes(source: QuakeSource, matcher: CountryMatcher): Promise<number> {
  const { rows } = await pool.query<{ last: Date | null }>('SELECT max(time) AS last FROM quakes WHERE source = $1', [source.name]);
  const now = Date.now();
  // Продолжаем с последнего события, захватив сутки назад: свежие события ещё уточняются.
  // Если загрузка упадёт посередине, следующий запуск начнёт с того же места.
  let from = rows[0].last ? rows[0].last.getTime() - DAY_MS : now - COLLECT_DAYS * DAY_MS;
  let total = 0;

  while (from < now) {
    const to = Math.min(from + CHUNK_DAYS * DAY_MS, now);
    const records = await source.fetch(new Date(from), new Date(to), MIN_MAGNITUDE);
    await upsertQuakes(records.map((r) => ({ ...r, countryCode: matcher.match(r.place) })));
    recordsCollected.inc({ source: source.name }, records.length);
    total += records.length;
    console.log(`[collector] ${source.name}: ${new Date(from).toISOString().slice(0, 10)} … ${records.length} events`);
    from = to;
  }
  return total;
}

async function runOnce(): Promise<boolean> {
  const started = Date.now();
  const matcher = await collectCountries();
  // allSettled: если один источник упал, второй всё равно соберётся.
  const results = await Promise.allSettled(SOURCES.map((s) => collectQuakes(s, matcher)));
  results.forEach((r, i) => {
    const name = SOURCES[i].name;
    runs.inc({ source: name, status: r.status === 'fulfilled' ? 'ok' : 'error' });
    if (r.status === 'fulfilled') {
      lastSuccess.setToCurrentTime({ source: name });
      console.log(`[collector] ${name}: done, ${r.value} events`);
    } else {
      console.error(`[collector] ${name}: failed —`, (r.reason as Error).message);
    }
  });
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM quakes');
  console.log(`[collector] run finished in ${((Date.now() - started) / 1000).toFixed(1)}s, quakes in DB: ${rows[0].count}`);
  return results.every((r) => r.status === 'fulfilled');
}

async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    await runOnce();
    await pool.end();
    return;
  }
  serveMetrics(Number(process.env.METRICS_PORT ?? 9464));
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    const ok = await runOnce().catch((err) => {
      console.error('[collector] run failed:', (err as Error).message);
      return false;
    });
    timer = setTimeout(loop, ok ? INTERVAL_MS : RETRY_MS);
  };
  process.once('SIGTERM', () => {
    clearTimeout(timer);
    void pool.end().then(() => process.exit(0));
  });
  await loop();
}

void main();
