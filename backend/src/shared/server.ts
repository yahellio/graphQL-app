import http from 'node:http';
import express, { type RequestHandler } from 'express';
import { ApolloServer, type ApolloServerOptions, type BaseContext } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginInlineTraceDisabled } from '@apollo/server/plugin/disabled';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { expressMiddleware } from '@as-integrations/express5';
import type { DocumentNode } from 'graphql';
import { checkDb, pool } from './db';
import { createContext } from './loaders';
import { metricsPlugin, registry } from './metrics';

interface ServiceOptions<TContext extends BaseContext> {
  name: string;
  port: number;
  apollo: ApolloServerOptions<TContext>;
  context: () => Promise<TContext>;
  middleware?: RequestHandler[];
  healthCheck?: () => Promise<void>;
  onShutdown?: () => Promise<void>;
}

// Общий запуск для gateway и подграфов: GraphQL, /health, /metrics и аккуратная остановка.
export async function startService<TContext extends BaseContext>(opts: ServiceOptions<TContext>): Promise<void> {
  const app = express();
  app.set('trust proxy', 'loopback, linklocal, uniquelocal'); // чтобы rate limit видел IP клиента, а не nginx
  const httpServer = http.createServer(app);

  const server = new ApolloServer<TContext>({
    ...opts.apollo,
    plugins: [
      ...(opts.apollo.plugins ?? []),
      ApolloServerPluginDrainHttpServer({ httpServer }), // при остановке дожидается текущих запросов
      metricsPlugin(opts.name),
    ],
  } as ApolloServerOptions<TContext>);
  await server.start();

  app.get('/health', async (_req, res) => {
    try {
      await opts.healthCheck?.();
      res.json({ status: 'ok', service: opts.name });
    } catch (err) {
      res.status(503).json({ status: 'error', service: opts.name, message: (err as Error).message });
    }
  });

  app.get('/metrics', async (_req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });

  app.use(
    '/graphql',
    ...(opts.middleware ?? []),
    express.json({ limit: '100kb' }),
    expressMiddleware(server, { context: opts.context }),
  );

  await new Promise<void>((resolve) => httpServer.listen(opts.port, resolve));
  console.log(`[${opts.name}] ready at http://localhost:${opts.port}/graphql`);

  const shutdown = async (signal: string) => {
    console.log(`[${opts.name}] ${signal} received, shutting down...`);
    await server.stop();
    await opts.onShutdown?.();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

export function startSubgraph(name: string, port: number, typeDefs: DocumentNode, resolvers: object): Promise<void> {
  return startService({
    name,
    port,
    apollo: {
      // as any: тип резолверов в @apollo/subgraph не умеет в свой контекст и не экспортируется.
      schema: buildSubgraphSchema({ typeDefs, resolvers: resolvers as any }),
      plugins: [ApolloServerPluginInlineTraceDisabled()], // трассировку пишем через OpenTelemetry
    },
    context: createContext,
    healthCheck: checkDb,
    onShutdown: () => pool.end(),
  });
}
