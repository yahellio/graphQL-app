import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { normalizePage, type Page, type PageInput } from '../shared/db';
import { groupBy, type RequestContext } from '../shared/loaders';
import * as repo from './repository';
import type { Quake, QuakeFilter, QuakeInput, QuakeSort } from './repository';

interface ListArgs {
  filter?: QuakeFilter;
  sort?: QuakeSort;
  page?: PageInput;
}

/**
 * Источник для QuakePage. Если задан countryCode — это вложенный список страны,
 * и данные грузятся пакетно через DataLoader (одним SQL для всех стран на странице).
 */
interface QuakePageSource {
  filter?: QuakeFilter;
  sort: QuakeSort;
  page: Page;
  countryCode?: string;
}

const DEFAULT_SORT: QuakeSort = { field: 'TIME', order: 'DESC' };

const toPageSource = (args: ListArgs, countryCode?: string): QuakePageSource => ({
  filter: args.filter,
  sort: args.sort ?? DEFAULT_SORT,
  page: normalizePage(args.page),
  countryCode,
});

// ---------- Кэш тяжёлых агрегаций (сбрасывается при любой мутации) ----------

const STATS_TTL_MS = 60_000;
const statsCache = new Map<string, { expires: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = statsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  if (statsCache.size > 500) statsCache.clear();
  const value = load().catch((err) => {
    statsCache.delete(key); // ошибки не кэшируем
    throw err;
  });
  statsCache.set(key, { expires: Date.now() + STATS_TTL_MS, value });
  return value;
}

// ---------- Валидация мутаций ----------

const badInput = (message: string) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const RULES: Partial<Record<keyof QuakeInput, (v: any) => boolean>> = {
  magnitude: (v: number) => v >= -2 && v <= 10,
  depthKm: (v: number) => v >= -10 && v <= 800,
  latitude: (v: number) => v >= -90 && v <= 90,
  longitude: (v: number) => v >= -180 && v <= 180,
  place: (v: string) => v.trim().length > 0 && v.length <= 200,
  countryCode: (v: string) => /^[A-Z]{2}$/.test(v),
};

function validate(input: QuakeInput): QuakeInput {
  const data = { ...input };
  if (typeof data.countryCode === 'string') data.countryCode = data.countryCode.toUpperCase();
  for (const [field, isValid] of Object.entries(RULES)) {
    const value = data[field as keyof QuakeInput];
    if (value != null && !isValid(value)) throw badInput(`Invalid value for "${field}": ${value}`);
  }
  if (data.place === null || data.magnitude === null || data.latitude === null || data.longitude === null || data.time === null)
    throw badInput('time, magnitude, latitude, longitude and place cannot be null');
  return data;
}

const parseId = (id: string): string => {
  if (!/^\d{1,18}$/.test(id)) throw badInput(`Invalid quake id: ${id}`);
  return id;
};

// ---------- Резолверы ----------

export const resolvers = {
  DateTime: new GraphQLScalarType<Date, string>({
    name: 'DateTime',
    serialize: (value) => (value instanceof Date ? value : new Date(value as string)).toISOString(),
    parseValue: (value) => {
      const date = new Date(value as string);
      if (typeof value !== 'string' || Number.isNaN(date.getTime())) throw badInput(`Invalid DateTime: ${value}`);
      return date;
    },
    parseLiteral: (ast) => {
      if (ast.kind !== Kind.STRING || Number.isNaN(Date.parse(ast.value))) throw badInput('DateTime must be an ISO 8601 string');
      return new Date(ast.value);
    },
  }),

  Query: {
    quakes: (_: unknown, args: ListArgs) => toPageSource(args),
    quakeStats: (_: unknown, { filter }: { filter?: QuakeFilter }) => ({ filter }),
  },

  Mutation: {
    createQuake: async (_: unknown, { input }: { input: QuakeInput }) => {
      const quake = await repo.insertQuake(validate(input));
      statsCache.clear();
      return quake;
    },
    updateQuake: async (_: unknown, { id, input }: { id: string; input: QuakeInput }) => {
      const data = validate(input);
      if (!Object.values(data).some((v) => v !== undefined)) throw badInput('Nothing to update');
      const quake = await repo.updateQuake(parseId(id), data);
      if (!quake) throw new GraphQLError(`Quake ${id} not found`, { extensions: { code: 'NOT_FOUND' } });
      statsCache.clear();
      return quake;
    },
    deleteQuake: async (_: unknown, { id }: { id: string }) => {
      const deleted = await repo.deleteQuake(parseId(id));
      if (deleted) statsCache.clear();
      return deleted;
    },
  },

  QuakePage: {
    items: (p: QuakePageSource, _: unknown, ctx: RequestContext) => {
      if (!p.countryCode) return repo.findQuakes(p.filter, p.sort, p.page);
      const key = `countryQuakes:${JSON.stringify([p.filter, p.sort, p.page])}`;
      return ctx.loaders
        .get(key, async (codes) => groupBy(codes, await repo.findByCountries(codes, p.filter, p.sort, p.page), (q) => q.countryCode!))
        .load(p.countryCode);
    },
    total: (p: QuakePageSource, _: unknown, ctx: RequestContext) =>
      p.countryCode ? countForCountry(ctx, p.countryCode, p.filter) : repo.countQuakes(p.filter),
  },

  Quake: {
    /** Отдаём только ссылку { code } — остальные поля страны достроит подграф countries. */
    country: (q: Quake) => (q.countryCode ? { __typename: 'Country', code: q.countryCode } : null),
  },

  Country: {
    __resolveReference: (ref: { code: string }) => ref,
    quakes: (c: { code: string }, args: ListArgs) => toPageSource(args, c.code),
    quakeCount: (c: { code: string }, _: unknown, ctx: RequestContext) => countForCountry(ctx, c.code),
  },

  QuakeStats: {
    total: async ({ filter }: { filter?: QuakeFilter }) => (await summaryOf(filter)).total,
    avgMagnitude: async ({ filter }: { filter?: QuakeFilter }) => (await summaryOf(filter)).avgMagnitude,
    maxMagnitude: async ({ filter }: { filter?: QuakeFilter }) => (await summaryOf(filter)).maxMagnitude,
    avgDepthKm: async ({ filter }: { filter?: QuakeFilter }) => (await summaryOf(filter)).avgDepthKm,
    bySource: ({ filter }: { filter?: QuakeFilter }) => cached(`source:${JSON.stringify(filter)}`, () => repo.groupCounts('source', filter)),
    byMagnitude: ({ filter }: { filter?: QuakeFilter }) =>
      cached(`magnitude:${JSON.stringify(filter)}`, () => repo.groupCounts('magnitude', filter)),
    byMonth: ({ filter }: { filter?: QuakeFilter }) => cached(`month:${JSON.stringify(filter)}`, () => repo.groupCounts('month', filter)),
    topCountries: async ({ filter }: { filter?: QuakeFilter }, { limit }: { limit: number }) => {
      const safeLimit = Math.min(Math.max(limit, 1), 50);
      const rows = await cached(`top:${safeLimit}:${JSON.stringify(filter)}`, () => repo.topCountries(safeLimit, filter));
      return rows.map((r) => ({ country: { __typename: 'Country', code: r.code }, count: r.count }));
    },
  },
};

function summaryOf(filter?: QuakeFilter) {
  return cached(`summary:${JSON.stringify(filter)}`, () => repo.summary(filter));
}

/** Количество событий по стране — пакетно (GROUP BY) для всех стран на странице. */
function countForCountry(ctx: RequestContext, code: string, filter?: QuakeFilter): Promise<number> {
  return ctx.loaders
    .get(`countryCount:${JSON.stringify(filter ?? null)}`, async (codes) => {
      const counts = await repo.countByCountries(codes, filter);
      return codes.map((c) => counts.get(c) ?? 0);
    })
    .load(code);
}
