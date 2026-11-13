import { composeServices } from '@apollo/composition';
import { ApolloGateway, RemoteGraphQLDataSource } from '@apollo/gateway';
import type { ApolloServerPlugin } from '@apollo/server';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { rateLimit } from 'express-rate-limit';
import { GraphQLError, type GraphQLField } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { getComplexity, simpleEstimator, type ComplexityEstimator } from 'graphql-query-complexity';
import { typeDefs as countriesTypeDefs } from '../countries/schema';
import { DEFAULT_PAGE_SIZE } from '../shared/db';
import { rejectedRequests } from '../shared/metrics';
import { startService } from '../shared/server';
import { typeDefs as quakesTypeDefs } from '../quakes/schema';

const MAX_DEPTH = Number(process.env.MAX_QUERY_DEPTH ?? 8);
const MAX_COMPLEXITY = Number(process.env.MAX_QUERY_COMPLEXITY ?? 5000);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);
const SUBGRAPH_TIMEOUT_MS = Number(process.env.SUBGRAPH_TIMEOUT_MS ?? 10_000);

// ---------- Federation: supergraph собирается из SDL подграфов при старте ----------
// Аналог `rover supergraph compose`: gateway не зависит от доступности подграфов при запуске,
// а ошибки совместимости схем обнаруживаются сразу.

const composition = composeServices([
  { name: 'countries', typeDefs: countriesTypeDefs, url: process.env.COUNTRIES_URL ?? 'http://localhost:4001/graphql' },
  { name: 'quakes', typeDefs: quakesTypeDefs, url: process.env.QUAKES_URL ?? 'http://localhost:4002/graphql' },
]);
if (composition.errors) {
  throw new Error(`Supergraph composition failed:\n${composition.errors.map((e) => e.message).join('\n')}`);
}

const gateway = new ApolloGateway({
  supergraphSdl: composition.supergraphSdl,
  // Таймаут на каждый запрос к подграфу: медленный сервис не «подвесит» gateway.
  // Если подграф недоступен, клиент получит частичные данные + ошибку в errors[].
  buildService: ({ url }) =>
    new RemoteGraphQLDataSource({
      url,
      fetcher: ((input: string, init: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS) })) as any,
    }),
});

// ---------- Контроль нагрузки ----------

/** Сложность списка = размер страницы × сложность одного элемента. */
const paginationEstimator: ComplexityEstimator = ({ field, args, childComplexity }) => {
  const hasPage = (field as GraphQLField<unknown, unknown>).args.some((a) => a.name === 'page');
  const size = args.limit ?? (hasPage ? (args.page?.limit ?? DEFAULT_PAGE_SIZE) : undefined);
  if (typeof size === 'number') return 1 + size * Math.max(childComplexity, 1);
};

const complexityPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ request, document, schema }) {
        const complexity = getComplexity({
          schema,
          query: document,
          operationName: request.operationName,
          variables: request.variables,
          estimators: [paginationEstimator, simpleEstimator({ defaultComplexity: 1 })],
        });
        if (complexity > MAX_COMPLEXITY) {
          rejectedRequests.inc({ reason: 'complexity' });
          throw new GraphQLError(`Query is too complex: ${complexity}. Maximum allowed: ${MAX_COMPLEXITY}`, {
            extensions: { code: 'QUERY_TOO_COMPLEX', http: { status: 400 } },
          });
        }
      },
      async didEncounterErrors({ errors }) {
        if (errors.some((e) => e.message.includes('exceeds maximum operation depth'))) rejectedRequests.inc({ reason: 'depth' });
      },
    };
  },
};

const rateLimiter = rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    rejectedRequests.inc({ reason: 'rate_limit' });
    res.status(429).json({ errors: [{ message: 'Too many requests, try again later', extensions: { code: 'RATE_LIMITED' } }] });
  },
});

void startService({
  name: 'gateway',
  port: Number(process.env.PORT ?? 4000),
  apollo: {
    gateway,
    introspection: true,
    validationRules: [depthLimit(MAX_DEPTH)],
    plugins: [complexityPlugin, ApolloServerPluginLandingPageLocalDefault({ embed: true })],
  },
  context: async () => ({}),
  middleware: [rateLimiter],
});
