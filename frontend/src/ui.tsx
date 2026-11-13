import { useEffect, useState, type ReactNode } from 'react';
import type { SortOrder } from './graphql';

// Чтобы поиск не отправлял запрос на каждое нажатие клавиши.
export function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(Math.ceil(total / limit), 1);
  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => onChange(0)}>«</button>
      <button disabled={page <= 1} onClick={() => onChange(offset - limit)}>‹</button>
      <span>
        стр. {page} из {pages} · всего {total.toLocaleString('ru')}
      </span>
      <button disabled={page >= pages} onClick={() => onChange(offset + limit)}>›</button>
      <button disabled={page >= pages} onClick={() => onChange((pages - 1) * limit)}>»</button>
    </div>
  );
}

export function SortHeader<F extends string>({
  field,
  sort,
  onSort,
  children,
}: {
  field: F;
  sort: { field: F; order: SortOrder };
  onSort: (s: { field: F; order: SortOrder }) => void;
  children: ReactNode;
}) {
  const active = sort.field === field;
  const next: SortOrder = active && sort.order === 'DESC' ? 'ASC' : 'DESC';
  return (
    <th className="sortable" onClick={() => onSort({ field, order: next })}>
      {children} {active ? (sort.order === 'DESC' ? '▼' : '▲') : ''}
    </th>
  );
}

// «Загрузка…» показываем только в первый раз, иначе таблица прыгала бы при каждой смене фильтра.
export function Status({ loading, hasData, error }: { loading: boolean; hasData: boolean; error?: { message: string } }) {
  if (error) return <div className="error">Ошибка: {error.message}</div>;
  return loading && !hasData ? <div className="muted">Загрузка…</div> : null;
}

export function Bars({ items, label = (k) => k }: { items: { key: string; count: number }[]; label?: (key: string) => string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar-row" key={i.key}>
          <span className="bar-label">{label(i.key)}</span>
          <span className="bar" style={{ width: `${(i.count / max) * 100}%` }} />
          <span className="bar-value">{i.count.toLocaleString('ru')}</span>
        </div>
      ))}
    </div>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' });
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('ru', { maximumFractionDigits: digits });
export const fmtMag = (m: number) => m.toLocaleString('ru', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtBig = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1e12 ? `${fmtNum(n / 1e12, 2)} трлн` : n >= 1e9 ? `${fmtNum(n / 1e9, 2)} млрд` : n >= 1e6 ? `${fmtNum(n / 1e6, 1)} млн` : fmtNum(n);
export const magClass = (m: number) => (m >= 6 ? 'mag high' : m >= 5 ? 'mag mid' : 'mag');
