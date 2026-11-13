import { useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { COUNTRIES, COUNTRY_DETAILS, type CountrySort } from '../graphql';
import { Pager, SortHeader, Status, fmtBig, fmtDate, fmtMag, fmtNum, magClass, useDebounced } from '../ui';

const PAGE_SIZE = 20;
const DETAIL_PAGE_SIZE = 10;

export function CountriesPage() {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [sort, setSort] = useState<CountrySort>({ field: 'POPULATION', order: 'DESC' });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search);
  const { data, previousData, loading, error } = useQuery(COUNTRIES, {
    variables: {
      filter: { search: debouncedSearch || undefined, regions: region ? [region] : undefined },
      sort,
      page: { limit: PAGE_SIZE, offset },
    },
  });
  const result = data ?? previousData;

  return (
    <div className="split">
      <section>
        <div className="filters">
          <input placeholder="Поиск страны" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
          <select value={region} onChange={(e) => { setRegion(e.target.value); setOffset(0); }}>
            <option value="">Все регионы</option>
            {result?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button onClick={() => setSort({ field: 'NAME', order: 'ASC' })}>По алфавиту</button>
        </div>
        <Status loading={loading} hasData={!!result} error={error} />
        {result && (
          <div className={loading ? 'stale' : undefined}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <SortHeader field="NAME" sort={sort} onSort={setSort}>Страна</SortHeader>
                    <th>Регион</th>
                    <SortHeader field="POPULATION" sort={sort} onSort={setSort}>Население</SortHeader>
                    <SortHeader field="GDP" sort={sort} onSort={setSort}>ВВП, $</SortHeader>
                    <th title="Поле из подграфа quakes">Землетрясений</th>
                  </tr>
                </thead>
                <tbody>
                  {result.countries.items.map((c) => (
                    <tr key={c.code} className={c.code === selected ? 'selected clickable' : 'clickable'} onClick={() => setSelected(c.code)}>
                      <td><b>{c.code}</b> {c.name}</td>
                      <td className="muted">{c.region}</td>
                      <td className="num">{fmtBig(c.population)}</td>
                      <td className="num">{fmtBig(c.gdpUsd)}</td>
                      <td className="num">{fmtNum(c.quakeCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager total={result.countries.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </div>
        )}
      </section>
      {selected && <CountryCard key={selected} code={selected} onSelect={setSelected} />}
    </div>
  );
}

function CountryCard({ code, onSelect }: { code: string; onSelect: (code: string) => void }) {
  const [offset, setOffset] = useState(0);
  const { data, previousData, loading, error } = useQuery(COUNTRY_DETAILS, {
    variables: { code, page: { limit: DETAIL_PAGE_SIZE, offset } },
  });
  const c = (data ?? previousData)?.country;

  return (
    <aside className="card country-card">
      <Status loading={loading} hasData={!!c} error={error} />
      {c && (
        <>
          <h2>{c.name} <small className="muted">{c.code} / {c.code3}</small></h2>
          <dl>
            <dt>Регион</dt><dd>{c.region}</dd>
            <dt>Уровень дохода</dt><dd>{c.incomeLevel}</dd>
            <dt>Столица</dt><dd>{c.capital ?? '—'}</dd>
            <dt>Население</dt><dd>{fmtNum(c.population)}</dd>
            <dt>ВВП / на душу</dt><dd>{fmtBig(c.gdpUsd)} $ / {fmtNum(c.gdpPerCapitaUsd)} $</dd>
            <dt>Землетрясений</dt><dd>{fmtNum(c.quakeCount)}</dd>
          </dl>

          <h3>Соседи (ближайшие столицы)</h3>
          <div className="chips">
            {c.neighbours.map((n) => (
              <button key={n.code} onClick={() => onSelect(n.code)}>{n.name} · {n.quakeCount}</button>
            ))}
          </div>

          <h3>Сильнейшие землетрясения</h3>
          {c.quakes.items.length === 0 ? (
            <p className="muted">Нет событий</p>
          ) : (
            <table className="compact">
              <tbody>
                {c.quakes.items.map((q) => (
                  <tr key={q.id}>
                    <td><span className={magClass(q.magnitude)}>{fmtMag(q.magnitude)}</span></td>
                    <td>{q.place}<br /><small className="muted">{fmtDate(q.time)} · {fmtNum(q.depthKm, 0)} км · {q.source}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.quakes.total > DETAIL_PAGE_SIZE && (
            <Pager total={c.quakes.total} limit={DETAIL_PAGE_SIZE} offset={offset} onChange={setOffset} />
          )}
        </>
      )}
    </aside>
  );
}
