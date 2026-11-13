import { normalizePage, type Page, type PageInput } from '../shared/db';
import { groupBy, type RequestContext } from '../shared/loaders';
import * as repo from './repository';
import type { Country, CountryFilter, CountrySort } from './repository';

interface CountriesArgs {
  filter?: CountryFilter;
  sort?: CountrySort;
  page?: PageInput;
}

/** Параметры страницы. Сами данные грузятся лениво — только запрошенные поля (items/total). */
interface CountryPageSource {
  filter?: CountryFilter;
  sort: CountrySort;
  page: Page;
}

const countryByCode = (ctx: RequestContext) =>
  ctx.loaders.get<Country | null>('countryByCode', async (codes) => {
    const rows = await repo.findByCodes(codes);
    return groupBy(codes, rows, (r) => r.code).map((g) => g[0] ?? null);
  });

export const resolvers = {
  Query: {
    countries: (_: unknown, args: CountriesArgs): CountryPageSource => ({
      filter: args.filter,
      sort: args.sort ?? { field: 'NAME', order: 'ASC' },
      page: normalizePage(args.page),
    }),
    country: (_: unknown, { code }: { code: string }, ctx: RequestContext) => countryByCode(ctx).load(code.toUpperCase()),
    regions: () => repo.regions(),
  },

  CountryPage: {
    items: (p: CountryPageSource) => repo.findCountries(p.filter, p.sort, p.page),
    total: (p: CountryPageSource) => repo.countCountries(p.filter),
  },

  Country: {
    /** Federation: gateway присылает { code } — достраиваем полную страну (пакетно). */
    __resolveReference: (ref: { code: string }, ctx: RequestContext) => countryByCode(ctx).load(ref.code),

    gdpPerCapitaUsd: (c: Country) => (c.gdpUsd && c.population ? Math.round(c.gdpUsd / c.population) : null),

    neighbours: async (c: Country, { limit }: { limit: number }, ctx: RequestContext) => {
      const loader = ctx.loaders.get('neighbours', async (codes) => {
        const rows = await repo.findNeighbours(codes);
        return groupBy(codes, rows, (r) => r.origin);
      });
      const list = await loader.load(c.code);
      return list.slice(0, Math.min(Math.max(limit, 0), repo.MAX_NEIGHBOURS));
    },
  },
};
