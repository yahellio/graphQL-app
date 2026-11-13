import { ApolloProvider } from '@apollo/client/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { client } from './graphql';
import { CountriesPage } from './pages/CountriesPage';
import { QuakesPage } from './pages/QuakesPage';
import { StatsPage } from './pages/StatsPage';
import './styles.css';

const TABS = {
  quakes: { title: 'Землетрясения', Page: QuakesPage },
  countries: { title: 'Страны', Page: CountriesPage },
  stats: { title: 'Статистика', Page: StatsPage },
};
type Tab = keyof typeof TABS;

function App() {
  const [tab, setTab] = useState<Tab>('quakes');
  const { Page } = TABS[tab];
  return (
    <>
      <header>
        <h1>🌍 Seismo</h1>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {TABS[t].title}
            </button>
          ))}
        </nav>
        <span className="muted">USGS · EMSC · World Bank → GraphQL Federation</span>
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={client}>
      <App />
    </ApolloProvider>
  </StrictMode>,
);
