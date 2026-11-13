import { Pool } from 'pg';

/** Общий пул соединений. Таймауты защищают сервис от «зависших» запросов к БД. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://seismo:seismo@localhost:5432/seismo',
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
});
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

export const checkDb = async (): Promise<void> => {
  await pool.query('SELECT 1');
};

// ---------- Пагинация и сортировка (общие для всех подграфов) ----------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type SortOrder = 'ASC' | 'DESC';
export interface PageInput {
  limit?: number | null;
  offset?: number | null;
}
export interface Page {
  limit: number;
  offset: number;
}

/** Ограничивает размер страницы: клиент не может запросить «всю таблицу». */
export function normalizePage(page?: PageInput | null): Page {
  const limit = Math.min(Math.max(page?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(page?.offset ?? 0, 0);
  return { limit, offset };
}

// ---------- Динамическое построение SQL ----------

/**
 * Собирает WHERE из условий с позиционными параметрами ($1, $2, ...).
 * Значения пользователя всегда уходят параметрами — SQL-инъекции исключены.
 */
export class SqlBuilder {
  readonly params: unknown[] = [];
  private readonly conditions: string[] = [];

  /** Регистрирует значение и возвращает плейсхолдер вида $N. */
  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  and(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  get where(): string {
    return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '';
  }
}

/** Экранирует спецсимволы LIKE, чтобы «%» и «_» из поиска искались буквально. */
export const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
