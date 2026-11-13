import http from 'node:http';
import type { ApolloServerPlugin } from '@apollo/server';
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // CPU, память, задержка event loop

const requestDuration = new client.Histogram({
  name: 'graphql_request_duration_seconds',
  help: 'Длительность GraphQL-операций',
  labelNames: ['service', 'operation', 'type', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const rejectedRequests = new client.Counter({
  name: 'graphql_rejected_requests_total',
  help: 'Запросы, отклонённые контролем нагрузки',
  labelNames: ['reason'],
  registers: [registry],
});

// Замеряет время каждой GraphQL-операции.
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

// У коллектора нет GraphQL-сервера, поэтому метрики он отдаёт через отдельный маленький HTTP-сервер.
export function serveMetrics(port: number): http.Server {
  return http
    .createServer(async (_req, res) => {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    })
    .listen(port);
}
