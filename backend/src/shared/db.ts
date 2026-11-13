import { Pool } from 'pg';

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

export function normalizePage(page?: PageInput | null): Page {
  const limit = Math.min(Math.max(page?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(page?.offset ?? 0, 0);
  return { limit, offset };
}

// Собирает WHERE из условий. Значения от клиента уходят параметрами ($1, $2, ...),
// поэтому SQL-инъекции невозможны.
export class SqlBuilder {
  readonly params: unknown[] = [];
  private readonly conditions: string[] = [];

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

// Экранируем % и _, чтобы они искались как обычные символы.
export const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
