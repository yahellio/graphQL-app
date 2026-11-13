import http from 'node:http';
import type { ApolloServerPlugin } from '@apollo/server';
import client from 'prom-client';

/** Реестр метрик Prometheus. Каждый сервис отдаёт его на GET /metrics. */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // CPU, память, event loop lag, GC

const requestDuration = new client.Histogram({
  name: 'graphql_request_duration_seconds',
  help: 'Длительность GraphQL-операций',
  labelNames: ['service', 'operation', 'type', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Запросы, отклонённые контролем нагрузки (rate limit, глубина, сложность). */
export const rejectedRequests = new client.Counter({
  name: 'graphql_rejected_requests_total',
  help: 'Запросы, отклонённые контролем нагрузки',
  labelNames: ['reason'],
  registers: [registry],
});

/** Apollo-плагин: замеряет каждую операцию и пишет её в гистограмму. */
export function metricsPlugin(service: string): ApolloServerPlugin {
  return {
    async requestDidStart() {
      const stop = requestDuration.startTimer({ service });
      return {
        async willSendResponse(ctx) {
          stop({
            operation: ctx.operationName ?? 'anonymous',
            type: ctx.operation?.operation ?? 'invalid',
            status: ctx.errors?.length ? 'error' : 'ok',
          });
        },
      };
    },
  };
}

/** Отдельный HTTP-сервер метрик для не-GraphQL процесса (коллектор). */
export function serveMetrics(port: number): http.Server {
  return http
    .createServer(async (_req, res) => {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    })
    .listen(port);
}
