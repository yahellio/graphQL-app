import { pool, SqlBuilder, likePattern, type Page, type SortOrder } from '../shared/db';

export interface Country {
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

export interface CountryFilter {
  search?: string | null;
  regions?: string[] | null;
}

export interface CountrySort {
  field: 'NAME' | 'POPULATION' | 'GDP';
  order: SortOrder;
}

const COLUMNS = `code, code3, name, region, income_level AS "incomeLevel", capital, latitude, longitude,
  population::float8 AS population, gdp_usd AS "gdpUsd"`;

/** Белый список колонок сортировки: enum из GraphQL -> имя колонки. */
const SORT_COLUMNS: Record<CountrySort['field'], string> = { NAME: 'name', POPULATION: 'population', GDP: 'gdp_usd' };

/** Динамически строит WHERE из фильтра: в SQL попадают только заданные условия. */
function buildWhere(f: CountryFilter = {}): SqlBuilder {
  const sql = new SqlBuilder();
  if (f.search?.trim()) sql.and(`name ILIKE ${sql.p(likePattern(f.search.trim()))}`);
  if (f.regions?.length) sql.and(`region = ANY(${sql.p(f.regions)})`);
  return sql;
}

export async function findCountries(filter: CountryFilter | undefined, sort: CountrySort, page: Page): Promise<Country[]> {
  const sql = buildWhere(filter);
  const { rows } = await pool.query<Country>(
    `SELECT ${COLUMNS} FROM countries ${sql.where}
     ORDER BY ${SORT_COLUMNS[sort.field]} ${sort.order} NULLS LAST, code
     LIMIT ${sql.p(page.limit)} OFFSET ${sql.p(page.offset)}`,
    sql.params,
  );
  return rows;
}

export async function countCountries(filter?: CountryFilter): Promise<number> {
  const sql = buildWhere(filter);
  const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM countries ${sql.where}`, sql.params);
  return rows[0].count;
}

/** Пакетная загрузка по кодам (для DataLoader и resolveReference федерации). */
export async function findByCodes(codes: readonly string[]): Promise<Country[]> {
  const { rows } = await pool.query<Country>(`SELECT ${COLUMNS} FROM countries WHERE code = ANY($1)`, [codes]);
  return rows;
}

export const MAX_NEIGHBOURS = 10;

/**
 * Ближайшие страны по координатам столиц — один запрос сразу для всех стран страницы
 * (LATERAL JOIN). Расстояние — приближение равнопромежуточной проекции, для сортировки достаточно.
 */
export async function findNeighbours(codes: readonly string[]): Promise<(Country & { origin: string })[]> {
  const { rows } = await pool.query<Country & { origin: string }>(
    `SELECT src.code AS origin, n.*
     FROM countries src
     CROSS JOIN LATERAL (
       SELECT ${COLUMNS} FROM countries c
       WHERE c.code <> src.code AND c.latitude IS NOT NULL
       ORDER BY power(c.latitude - src.latitude, 2)
              + power((c.longitude - src.longitude) * cos(radians(src.latitude)), 2)
       LIMIT ${MAX_NEIGHBOURS}
     ) n
     WHERE src.code = ANY($1) AND src.latitude IS NOT NULL`,
    [codes],
  );
  return rows;
}

export async function regions(): Promise<string[]> {
  const { rows } = await pool.query<{ region: string }>('SELECT DISTINCT region FROM countries ORDER BY 1');
  return rows.map((r) => r.region);
}
