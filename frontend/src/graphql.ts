import { ApolloClient, HttpLink, InMemoryCache, gql, type TypedDocumentNode } from '@apollo/client';

/** Единственный канал связи с backend — GraphQL gateway (/graphql проксируется nginx/vite). */
export const client = new ApolloClient({
  link: new HttpLink({ uri: '/graphql' }),
  cache: new InMemoryCache({
    typePolicies: { Country: { keyFields: ['code'] } }, // у страны ключ — ISO-код, а не id
  }),
});

// ---------- Типы ----------

export type SortOrder = 'ASC' | 'DESC';
export type QuakeSource = 'USGS' | 'EMSC' | 'MANUAL';
export interface Page {
  limit: number;
  offset: number;
}
export interface Bucket {
  key: string;
  count: number;
}

export interface CountryRef {
  code: string;
  name: string;
  region?: string;
}

export interface Quake {
  id: string;
  time: string;
  magnitude: number;
  magnitudeType: string | null;
  place: string;
  source: QuakeSource;
  url: string | null;
  depthKm?: number | null;
  latitude?: number;
  longitude?: number;
  country?: CountryRef | null;
}

export interface QuakeFilter {
  search?: string;
  sources?: QuakeSource[];
  minMagnitude?: number;
  maxMagnitude?: number;
  from?: string;
  to?: string;
  countryCodes?: string[];
}

export interface QuakeSort {
  field: 'TIME' | 'MAGNITUDE' | 'DEPTH';
  order: SortOrder;
}

export interface CountryRow {
  code: string;
  name: string;
  region: string;
  incomeLevel: string;
  population: number | null;
  gdpUsd: number | null;
  quakeCount: number;
}

export interface CountrySort {
  field: 'NAME' | 'POPULATION' | 'GDP';
  order: SortOrder;
}

// ---------- Землетрясения ----------

/**
 * Фрагмент с директивами @include: набор колонок таблицы выбирает пользователь,
 * и запрос формируется динамически — сервер получает только нужные поля.
 */
const QUAKE_ROW = gql`
  fragment QuakeRow on Quake {
    id
    time
    magnitude
    magnitudeType
    place
    source
    url
    depthKm @include(if: $withDepth)
    latitude @include(if: $withCoords)
    longitude @include(if: $withCoords)
    country @include(if: $withCountry) {
      code
      name
      region
    }
  }
`;

export interface QuakesVars {
  filter: QuakeFilter;
  sort: QuakeSort;
  page: Page;
  withDepth: boolean;
  withCoords: boolean;
  withCountry: boolean;
}

export const QUAKES: TypedDocumentNode<{ quakes: { total: number; items: Quake[] } }, QuakesVars> = gql`
  query Quakes(
    $filter: QuakeFilter
    $sort: QuakeSort
    $page: PageInput
    $withDepth: Boolean!
    $withCoords: Boolean!
    $withCountry: Boolean!
  ) {
    quakes(filter: $filter, sort: $sort, page: $page) {
      total
      items {
        ...QuakeRow
      }
    }
  }
  ${QUAKE_ROW}
`;

export interface QuakeInput {
  time: string;
  magnitude: number;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  place: string;
  countryCode: string | null;
}

export const CREATE_QUAKE: TypedDocumentNode<{ createQuake: { id: string } }, { input: QuakeInput }> = gql`
  mutation CreateQuake($input: CreateQuakeInput!) {
    createQuake(input: $input) {
      id
    }
  }
`;

export const UPDATE_QUAKE: TypedDocumentNode<{ updateQuake: { id: string } }, { id: string; input: Partial<QuakeInput> }> = gql`
  mutation UpdateQuake($id: ID!, $input: UpdateQuakeInput!) {
    updateQuake(id: $id, input: $input) {
      id
      magnitude
      place
      depthKm
    }
  }
`;

export const DELETE_QUAKE: TypedDocumentNode<{ deleteQuake: boolean }, { id: string }> = gql`
  mutation DeleteQuake($id: ID!) {
    deleteQuake(id: $id)
  }
`;

// ---------- Страны ----------

export const COUNTRIES: TypedDocumentNode<
  { countries: { total: number; items: CountryRow[] }; regions: string[] },
  { filter: { search?: string; regions?: string[] }; sort: CountrySort; page: Page }
> = gql`
  query Countries($filter: CountryFilter, $sort: CountrySort, $page: PageInput) {
    countries(filter: $filter, sort: $sort, page: $page) {
      total
      items {
        code
        name
        region
        incomeLevel
        population
        gdpUsd
        quakeCount # поле из подграфа quakes — склеивается gateway'ем
      }
    }
    regions
  }
`;

export interface CountryDetails extends CountryRow {
  code3: string;
  capital: string | null;
  gdpPerCapitaUsd: number | null;
  quakes: { total: number; items: Quake[] };
  neighbours: { code: string; name: string; quakeCount: number }[];
}

/** Вложенность: страна → её землетрясения (federation) и страны-соседи → их счётчики. */
export const COUNTRY_DETAILS: TypedDocumentNode<{ country: CountryDetails | null }, { code: string; page: Page }> = gql`
  query CountryDetails($code: ID!, $page: PageInput) {
    country(code: $code) {
      code
      code3
      name
      region
      incomeLevel
      capital
      population
      gdpUsd
      gdpPerCapitaUsd
      quakeCount
      quakes(sort: { field: MAGNITUDE, order: DESC }, page: $page) {
        total
        items {
          id
          time
          magnitude
          magnitudeType
          place
          source
          url
          depthKm
        }
      }
      neighbours(limit: 5) {
        code
        name
        quakeCount
      }
    }
  }
`;

// ---------- Статистика ----------

export interface QuakeStats {
  total: number;
  avgMagnitude: number | null;
  maxMagnitude: number | null;
  avgDepthKm: number | null;
  bySource: Bucket[];
  byMagnitude: Bucket[];
  byMonth: Bucket[];
  topCountries: { count: number; country: { code: string; name: string; region: string; population: number | null } }[];
}

export const QUAKE_STATS: TypedDocumentNode<{ quakeStats: QuakeStats }, { filter: QuakeFilter }> = gql`
  query QuakeStats($filter: QuakeFilter) {
    quakeStats(filter: $filter) {
      total
      avgMagnitude
      maxMagnitude
      avgDepthKm
      bySource {
        key
        count
      }
      byMagnitude {
        key
        count
      }
      byMonth {
        key
        count
      }
      topCountries(limit: 10) {
        count
        country {
          code
          name
          region
          population
        }
      }
    }
  }
`;
