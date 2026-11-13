import { useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { QUAKE_STATS, type QuakeSource } from '../graphql';
import { Bars, Status, fmtBig, fmtMag, fmtNum } from '../ui';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function StatsPage() {
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [source, setSource] = useState<QuakeSource | ''>('');
  const { data, previousData, loading, error } = useQuery(QUAKE_STATS, {
    variables: { filter: { minMagnitude, sources: source ? [source] : undefined } },
  });
  const s = (data ?? previousData)?.quakeStats;

  return (
    <section>
      <div className="filters">
        <label>
          Магнитуда от <b>{fmtMag(minMagnitude)}</b>
          <input type="range" min={2} max={7} step={0.5} value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} />
        </label>
        <select value={source} onChange={(e) => setSource(e.target.value as QuakeSource | '')}>
          <option value="">Все источники</option>
          <option>USGS</option>
          <option>EMSC</option>
          <option>MANUAL</option>
        </select>
      </div>
      <Status loading={loading} hasData={!!s} error={error} />
      {s && (
        <div className={loading ? 'stale' : undefined}>
          <div className="kpis">
            <div className="kpi"><span>Событий</span><b>{fmtNum(s.total)}</b></div>
            <div className="kpi"><span>Средняя магнитуда</span><b>{fmtNum(s.avgMagnitude, 2)}</b></div>
            <div className="kpi"><span>Максимальная</span><b>{fmtNum(s.maxMagnitude, 1)}</b></div>
            <div className="kpi"><span>Средняя глубина</span><b>{fmtNum(s.avgDepthKm, 1)} км</b></div>
          </div>
          <div className="grid">
            <div className="card">
              <h3>По магнитуде</h3>
              <Bars items={s.byMagnitude} label={(k) => `M${k}–${Number(k) + 1}`} />
            </div>
            <div className="card">
              <h3>По источникам</h3>
              <Bars items={s.bySource} />
            </div>
            <div className="card">
              <h3>По месяцам</h3>
              <Bars items={s.byMonth} label={(k) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`} />
            </div>
            <div className="card">
              <h3>Топ стран <small className="muted">(название и население — из подграфа countries)</small></h3>
              <Bars
                items={s.topCountries.map((t) => ({ key: t.country.code, count: t.count }))}
                label={(code) => {
                  const c = s.topCountries.find((t) => t.country.code === code)!.country;
                  return `${c.name} (${fmtBig(c.population)})`;
                }}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
