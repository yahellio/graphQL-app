# Seismo — GraphQL Federation

Клиент-серверное приложение для анализа землетрясений.
Данные собираются из USGS, EMSC и World Bank; backend — Apollo Federation (gateway + подграфы
`countries` и `quakes`), frontend — React + Apollo Client.

## Запуск

Нужен Docker с Compose v2.

```bash
docker compose up -d --build
```

Первый сбор данных занимает около минуты:

```bash
docker compose logs -f collector
```

| Сервис | Адрес |
|---|---|
| Приложение | http://localhost:8080 |
| GraphQL gateway (Apollo Sandbox) | http://localhost:4000/graphql |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Jaeger | http://localhost:16686 |

Остановить: `docker compose down` (с удалением данных — `docker compose down -v`).

## Структура проекта

```
backend/
  db/init.sql             схема БД и индексы
  src/shared/             общий код: БД и SqlBuilder, DataLoader, метрики, запуск сервиса
  src/countries/          подграф countries: schema → resolvers → repository (SQL)
  src/quakes/             подграф quakes:    schema → resolvers → repository (SQL)
  src/gateway/            federation gateway, rate limit, ограничения глубины и сложности
  src/collector/          сбор данных: sources (API), geo (место → страна), index (планировщик, upsert)
frontend/
  src/graphql.ts          Apollo Client, запросы и типы
  src/pages/              Землетрясения / Страны / Статистика
  src/ui.tsx              пагинация, сортировка, графики
  nginx.conf              раздача статики и прокси /graphql → gateway
monitoring/               Prometheus и Grafana (datasource, дашборд)
docker-compose.yml
```
