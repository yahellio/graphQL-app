-- Таблицами владеют разные сервисы (countries и quakes), поэтому внешнего ключа
-- quakes.country_code -> countries.code нет: их связывает GraphQL Federation.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS countries (
    code         text PRIMARY KEY CHECK (length(code) = 2),
    code3        text NOT NULL,
    name         text NOT NULL,
    region       text NOT NULL,
    income_level text NOT NULL,
    capital      text,
    latitude     double precision,
    longitude    double precision,
    population   bigint,
    gdp_usd      double precision,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS countries_name_trgm ON countries USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS countries_region ON countries (region);

CREATE TABLE IF NOT EXISTS quakes (
    id           bigserial PRIMARY KEY,
    source       text NOT NULL CHECK (source IN ('USGS', 'EMSC', 'MANUAL')),
    external_id  text NOT NULL,
    time         timestamptz NOT NULL,
    magnitude    double precision NOT NULL,
    mag_type     text,
    depth_km     double precision,
    latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    place        text NOT NULL,
    url          text,
    country_code text CHECK (length(country_code) = 2),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS quakes_time ON quakes (time DESC);
CREATE INDEX IF NOT EXISTS quakes_magnitude ON quakes (magnitude DESC);
CREATE INDEX IF NOT EXISTS quakes_depth ON quakes (depth_km);
CREATE INDEX IF NOT EXISTS quakes_country_time ON quakes (country_code, time DESC);
-- trigram-индексы ускоряют поиск через ILIKE '%текст%'
CREATE INDEX IF NOT EXISTS quakes_place_trgm ON quakes USING gin (place gin_trgm_ops);
