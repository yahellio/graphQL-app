import { pool, SqlBuilder, likePattern, type Page, type SortOrder } from '../shared/db';

export type QuakeSource = 'USGS' | 'EMSC' | 'MANUAL';

export interface Quake {
  id: string;
  source: QuakeSource;
  time: Date;
  magnitude: number;
  magnitudeType: string | null;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  place: string;
  url: string | null;
  countryCode: string | null;
}

export interface QuakeFilter {
  search?: string | null;
  sources?: QuakeSource[] | null;
  minMagnitude?: number | null;
  maxMagnitude?: number | null;
  from?: Date | null;
  to?: Date | null;
  countryCodes?: string[] | null;
}

export interface QuakeSort {
  field: 'TIME' | 'MAGNITUDE' | 'DEPTH';
  order: SortOrder;
}

/** Поля, которые можно задать через мутации (camelCase GraphQL -> колонка БД). */
export const WRITABLE_COLUMNS = {
  time: 'time',
  magnitude: 'magnitude',
  magnitudeType: 'mag_type',
  depthKm: 'depth_km',
  latitude: 'latitude',
  longitude: 'longitude',
  place: 'place',
  countryCode: 'country_code',
} as const;
export type QuakeInput = Partial<Record<keyof typeof WRITABLE_COLUMNS, unknown>>;

const COLUMNS = `id::text AS id, source, time, magnitude,
  mag_type AS "magnitudeType", depth_km AS "depthKm", latitude, longitude, place, url, country_code AS "countryCode"`;

const SORT_COLUMNS: Record<QuakeSort['field'], string> = { TIME: 'time', MAGNITUDE: 'magnitude', DEPTH: 'depth_km' };

const orderBy = (s: QuakeSort) => `${SORT_COLUMNS[s.field]} ${s.order} NULLS LAST, id ${s.order}`;

/** Динамически строит WHERE: в SQL попадают только реально заданные условия фильтра. */
function buildWhere(f: QuakeFilter = {}, sql = new SqlBuilder()): SqlBuilder {
  if (f.search?.trim()) sql.and(`place ILIKE ${sql.p(likePattern(f.search.trim()))}`);
  if (f.sources?.length) sql.and(`source = ANY(${sql.p(f.sources)})`);
  if (f.minMagnitude != null) sql.and(`magnitude >= ${sql.p(f.minMagnitude)}`);
  if (f.maxMagnitude != null) sql.and(`magnitude <= ${sql.p(f.maxMagnitude)}`);
  if (f.from) sql.and(`time >= ${sql.p(f.from)}`);
  if (f.to) sql.and(`time <= ${sql.p(f.to)}`);
  if (f.countryCodes?.length) sql.and(`country_code = ANY(${sql.p(f.countryCodes.map((c) => c.toUpperCase()))})`);
  return sql;
}

// ---------- Чтение ----------

export async function findQuakes(filter: QuakeFilter | undefined, sort: QuakeSort, page: Page): Promise<Quake[]> {
  const sql = buildWhere(filter);
  const { rows } = await pool.query<Quake>(
    `SELECT ${COLUMNS} FROM quakes ${sql.where} ORDER BY ${orderBy(sort)}
     LIMIT ${sql.p(page.limit)} OFFSET ${sql.p(page.offset)}`,
    sql.params,
  );
  return rows;
}

export async function countQuakes(filter?: QuakeFilter): Promise<number> {
  const sql = buildWhere(filter);
  const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM quakes ${sql.where}`, sql.params);
  return rows[0].count;
}

/**
 * Страница землетрясений сразу для многих стран одним запросом:
 * ROW_NUMBER() нумерует события внутри каждой страны, затем берём нужное окно.
 */
export async function findByCountries(
  codes: readonly string[],
  filter: QuakeFilter | undefined,
  sort: QuakeSort,
  page: Page,
): Promise<Quake[]> {
  const sql = buildWhere(filter);
  sql.and(`country_code = ANY(${sql.p(codes)})`);
  const { rows } = await pool.query<Quake>(
    `SELECT * FROM (
       SELECT ${COLUMNS}, ROW_NUMBER() OVER (PARTITION BY country_code ORDER BY ${orderBy(sort)}) AS rn
       FROM quakes ${sql.where}
     ) ranked
     WHERE rn > ${sql.p(page.offset)} AND rn <= ${sql.p(page.offset + page.limit)}
     ORDER BY "countryCode", rn`,
    sql.params,
  );
  return rows;
}

export async function countByCountries(codes: readonly string[], filter?: QuakeFilter): Promise<Map<string, number>> {
  const sql = buildWhere(filter);
  sql.and(`country_code = ANY(${sql.p(codes)})`);
  const { rows } = await pool.query<{ code: string; count: number }>(
    `SELECT country_code AS code, count(*)::int AS count FROM quakes ${sql.where} GROUP BY country_code`,
    sql.params,
  );
  return new Map(rows.map((r) => [r.code, r.count]));
}

// ---------- Агрегации для статистики ----------

export interface Summary {
  total: number;
  avgMagnitude: number | null;
  maxMagnitude: number | null;
  avgDepthKm: number | null;
}

export async function summary(filter?: QuakeFilter): Promise<Summary> {
  const sql = buildWhere(filter);
  const { rows } = await pool.query<Summary>(
    `SELECT count(*)::int AS total, round(avg(magnitude)::numeric, 2)::float8 AS "avgMagnitude",
            max(magnitude) AS "maxMagnitude", round(avg(depth_km)::numeric, 1)::float8 AS "avgDepthKm"
     FROM quakes ${sql.where}`,
    sql.params,
  );
  return rows[0];
}

export interface Bucket {
  key: string;
  count: number;
}

const GROUPINGS = {
  source: { expr: 'source', order: 'count DESC' },
  magnitude: { expr: `floor(magnitude)::int`, order: 'key' },
  month: { expr: `to_char(date_trunc('month', time AT TIME ZONE 'UTC'), 'YYYY-MM')`, order: 'key' },
} as const;

export async function groupCounts(by: keyof typeof GROUPINGS, filter?: QuakeFilter): Promise<Bucket[]> {
  const sql = buildWhere(filter);
  const { expr, order } = GROUPINGS[by];
  const { rows } = await pool.query<{ key: string | number; count: number }>(
    `SELECT ${expr} AS key, count(*)::int AS count FROM quakes ${sql.where} GROUP BY 1 ORDER BY ${order}`,
    sql.params,
  );
  return rows.map((r) => ({ key: String(r.key), count: r.count }));
}

export async function topCountries(limit: number, filter?: QuakeFilter): Promise<{ code: string; count: number }[]> {
  const sql = buildWhere(filter);
  sql.and('country_code IS NOT NULL');
  const { rows } = await pool.query<{ code: string; count: number }>(
    `SELECT country_code AS code, count(*)::int AS count FROM quakes ${sql.where}
     GROUP BY country_code ORDER BY count DESC LIMIT ${sql.p(limit)}`,
    sql.params,
  );
  return rows;
}

// ---------- Запись ----------

export async function insertQuake(input: QuakeInput): Promise<Quake> {
  const sql = new SqlBuilder();
  const entries = Object.entries(WRITABLE_COLUMNS).filter(([field]) => input[field as keyof QuakeInput] !== undefined);
  const columns = entries.map(([, column]) => column);
  const values = entries.map(([field]) => sql.p(input[field as keyof QuakeInput]));
  const { rows } = await pool.query<Quake>(
    `INSERT INTO quakes (source, external_id, ${columns.join(', ')})
     VALUES ('MANUAL', gen_random_uuid()::text, ${values.join(', ')})
     RETURNING ${COLUMNS}`,
    sql.params,
  );
  return rows[0];
}

export async function updateQuake(id: string, input: QuakeInput): Promise<Quake | null> {
  const sql = new SqlBuilder();
  const sets = Object.entries(WRITABLE_COLUMNS)
    .filter(([field]) => input[field as keyof QuakeInput] !== undefined)
    .map(([field, column]) => `${column} = ${sql.p(input[field as keyof QuakeInput])}`);
  const { rows } = await pool.query<Quake>(
    `UPDATE quakes SET ${[...sets, 'updated_at = now()'].join(', ')}
     WHERE id = ${sql.p(id)} RETURNING ${COLUMNS}`,
    sql.params,
  );
  return rows[0] ?? null;
}

export async function deleteQuake(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM quakes WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
