# Один образ для всех backend-сервисов (gateway, countries, quakes, collector).
# Какой сервис запустить — задаёт command в docker-compose.yml.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Автоинструментация OpenTelemetry (http, express, graphql, pg, fetch) без изменений в коде.
ENV NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/gateway/index.js"]
