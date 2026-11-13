import { useMutation, useQuery } from '@apollo/client/react';
import { useState, type FormEvent } from 'react';
import { CREATE_QUAKE, DELETE_QUAKE, QUAKES, UPDATE_QUAKE, type Quake, type QuakeFilter, type QuakeSort, type QuakeSource } from '../graphql';
import { Pager, SortHeader, Status, fmtDate, fmtNum, magClass, useDebounced } from '../ui';

const PAGE_SIZE = 25;
const SOURCES: QuakeSource[] = ['USGS', 'EMSC', 'MANUAL'];

interface Filters {
  search: string;
  sources: QuakeSource[];
  minMagnitude: string;
  maxMagnitude: string;
  from: string;
  to: string;
  country: string;
}

const EMPTY: Filters = { search: '', sources: [], minMagnitude: '', maxMagnitude: '', from: '', to: '', country: '' };

/** Переводит состояние формы в GraphQL-фильтр: пустые поля в запрос не попадают. */
function toFilter(f: Filters): QuakeFilter {
  const filter: QuakeFilter = {};
  if (f.search.trim()) filter.search = f.search.trim();
  if (f.sources.length) filter.sources = f.sources;
  if (f.minMagnitude) filter.minMagnitude = Number(f.minMagnitude);
  if (f.maxMagnitude) filter.maxMagnitude = Number(f.maxMagnitude);
  if (f.from) filter.from = new Date(f.from).toISOString();
  if (f.to) filter.to = new Date(`${f.to}T23:59:59`).toISOString();
  if (f.country.trim()) filter.countryCodes = [f.country.trim().toUpperCase()];
  return filter;
}

export function QuakesPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<QuakeSort>({ field: 'TIME', order: 'DESC' });
  const [offset, setOffset] = useState(0);
  const [columns, setColumns] = useState({ withDepth: true, withCoords: false, withCountry: true });
  const [editing, setEditing] = useState<Quake | 'new' | null>(null);

  const debouncedFilters = useDebounced(filters);
  const { data, previousData, loading, error } = useQuery(QUAKES, {
    variables: { filter: toFilter(debouncedFilters), sort, page: { limit: PAGE_SIZE, offset }, ...columns },
  });
  const result = (data ?? previousData)?.quakes;

  const [deleteQuake] = useMutation(DELETE_QUAKE, { refetchQueries: 'active' });

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const toggleSource = (s: QuakeSource) =>
    update({ sources: filters.sources.includes(s) ? filters.sources.filter((x) => x !== s) : [...filters.sources, s] });

  return (
    <section>
      <div className="filters">
        <input placeholder="Поиск по месту (Japan, Alaska…)" value={filters.search} onChange={(e) => update({ search: e.target.value })} />
        <input type="number" step="0.1" placeholder="Маг. от" value={filters.minMagnitude} onChange={(e) => update({ minMagnitude: e.target.value })} />
        <input type="number" step="0.1" placeholder="Маг. до" value={filters.maxMagnitude} onChange={(e) => update({ maxMagnitude: e.target.value })} />
        <label>с <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} /></label>
        <label>по <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} /></label>
        <input className="short" placeholder="Страна (JP)" maxLength={2} value={filters.country} onChange={(e) => update({ country: e.target.value })} />
        {SOURCES.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={filters.sources.includes(s)} onChange={() => toggleSource(s)} /> {s}
          </label>
        ))}
        <button onClick={() => update(EMPTY)}>Сбросить</button>
      </div>

      <div className="toolbar">
        <span className="muted">Колонки (запрос строится динамически):</span>
        {(
          [
            ['withDepth', 'Глубина'],
            ['withCoords', 'Координаты'],
            ['withCountry', 'Страна'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={columns[key]} onChange={() => setColumns((c) => ({ ...c, [key]: !c[key] }))} /> {label}
          </label>
        ))}
        <button className="primary" onClick={() => setEditing('new')}>+ Добавить событие</button>
      </div>

      {editing && (
        <QuakeForm key={editing === 'new' ? 'new' : editing.id} quake={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}

      <Status loading={loading} error={error} />
      {result && (
        <>
          <table>
            <thead>
              <tr>
                <SortHeader field="TIME" sort={sort} onSort={setSort}>Время</SortHeader>
                <SortHeader field="MAGNITUDE" sort={sort} onSort={setSort}>Магн.</SortHeader>
                {columns.withDepth && <SortHeader field="DEPTH" sort={sort} onSort={setSort}>Глубина, км</SortHeader>}
                <th>Место</th>
                {columns.withCoords && <th>Координаты</th>}
                {columns.withCountry && <th>Страна</th>}
                <th>Источник</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.items.map((q) => (
                <tr key={q.id}>
                  <td>{fmtDate(q.time)}</td>
                  <td><span className={magClass(q.magnitude)}>{q.magnitude.toFixed(1)}</span> <small className="muted">{q.magnitudeType}</small></td>
                  {columns.withDepth && <td>{fmtNum(q.depthKm, 1)}</td>}
                  <td>{q.url ? <a href={q.url} target="_blank" rel="noreferrer">{q.place}</a> : q.place}</td>
                  {columns.withCoords && <td>{q.latitude?.toFixed(2)}, {q.longitude?.toFixed(2)}</td>}
                  {columns.withCountry && <td>{q.country ? `${q.country.name}` : <span className="muted">—</span>}</td>}
                  <td><span className={`tag ${q.source}`}>{q.source}</span></td>
                  <td className="actions">
                    <button title="Изменить" onClick={() => setEditing(q)}>✎</button>
                    <button title="Удалить" onClick={() => confirm(`Удалить событие «${q.place}»?`) && deleteQuake({ variables: { id: q.id } })}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={result.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        </>
      )}
    </section>
  );
}

/** Форма создания/редактирования события (мутации createQuake / updateQuake). */
function QuakeForm({ quake, onClose }: { quake: Quake | null; onClose: () => void }) {
  const [form, setForm] = useState({
    time: (quake ? new Date(quake.time) : new Date()).toISOString().slice(0, 16),
    magnitude: String(quake?.magnitude ?? ''),
    depthKm: String(quake?.depthKm ?? ''),
    latitude: String(quake?.latitude ?? ''),
    longitude: String(quake?.longitude ?? ''),
    place: quake?.place ?? '',
    countryCode: quake?.country?.code ?? '',
  });
  const options = { refetchQueries: 'active' as const, onCompleted: onClose };
  const [create, createState] = useMutation(CREATE_QUAKE, options);
  const [update, updateState] = useMutation(UPDATE_QUAKE, options);
  const error = createState.error ?? updateState.error;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = {
      time: new Date(`${form.time}Z`).toISOString(),
      magnitude: Number(form.magnitude),
      depthKm: form.depthKm === '' ? null : Number(form.depthKm),
      place: form.place,
      countryCode: form.countryCode.trim() || null,
    };
    if (quake) {
      // координаты меняем, только если они были загружены (колонка «Координаты» включена)
      const coords = form.latitude && form.longitude ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : {};
      void update({ variables: { id: quake.id, input: { ...input, ...coords } } });
    } else {
      void create({ variables: { input: { ...input, latitude: Number(form.latitude), longitude: Number(form.longitude) } } });
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text', step?: string) => (
    <label>
      {label}
      <input type={type} step={step} value={form[key]} required={['magnitude', 'place', 'time'].includes(key) || (!quake && ['latitude', 'longitude'].includes(key))}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </label>
  );

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{quake ? `Изменить событие #${quake.id}` : 'Новое событие (источник MANUAL)'}</h3>
      <div className="form-grid">
        {field('time', 'Время (UTC)', 'datetime-local')}
        {field('magnitude', 'Магнитуда', 'number', '0.1')}
        {field('depthKm', 'Глубина, км', 'number', '0.1')}
        {field('latitude', 'Широта', 'number', 'any')}
        {field('longitude', 'Долгота', 'number', 'any')}
        {field('place', 'Место')}
        {field('countryCode', 'Код страны (BY)')}
      </div>
      {error && <div className="error">{error.message}</div>}
      <div className="form-actions">
        <button className="primary" type="submit" disabled={createState.loading || updateState.loading}>Сохранить</button>
        <button type="button" onClick={onClose}>Отмена</button>
      </div>
    </form>
  );
}
