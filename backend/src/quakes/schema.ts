import { parse } from 'graphql';

/** Подграф «quakes»: сейсмические события (USGS, EMSC, ручной ввод) и аналитика. */
export const typeDefs = parse(/* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  "Дата-время в формате ISO 8601"
  scalar DateTime

  enum SortOrder {
    ASC
    DESC
  }

  "Пагинация: limit ограничен 100 записями на странице."
  input PageInput {
    limit: Int = 20
    offset: Int = 0
  }

  enum QuakeSource {
    USGS
    EMSC
    MANUAL
  }

  type Quake {
    id: ID!
    source: QuakeSource!
    time: DateTime!
    magnitude: Float!
    magnitudeType: String
    depthKm: Float
    latitude: Float!
    longitude: Float!
    place: String!
    url: String
    "Страна резолвится подграфом countries через федерацию"
    country: Country
  }

  type QuakePage {
    items: [Quake!]!
    total: Int!
  }

  input QuakeFilter {
    "Поиск по описанию места (подстрока, без учёта регистра)"
    search: String
    sources: [QuakeSource!]
    minMagnitude: Float
    maxMagnitude: Float
    from: DateTime
    to: DateTime
    countryCodes: [ID!]
  }

  enum QuakeSortField {
    TIME
    MAGNITUDE
    DEPTH
  }

  input QuakeSort {
    field: QuakeSortField! = TIME
    order: SortOrder! = DESC
  }

  "Расширение сущности Country из подграфа countries"
  type Country @key(fields: "code") {
    code: ID!
    quakes(filter: QuakeFilter, sort: QuakeSort, page: PageInput): QuakePage!
    quakeCount: Int!
  }

  type Bucket {
    key: String!
    count: Int!
  }

  type CountryQuakeCount {
    country: Country!
    count: Int!
  }

  type QuakeStats {
    total: Int!
    avgMagnitude: Float
    maxMagnitude: Float
    avgDepthKm: Float
    bySource: [Bucket!]!
    "Гистограмма по целой части магнитуды"
    byMagnitude: [Bucket!]!
    byMonth: [Bucket!]!
    topCountries(limit: Int = 10): [CountryQuakeCount!]!
  }

  input CreateQuakeInput {
    time: DateTime!
    magnitude: Float!
    magnitudeType: String
    depthKm: Float
    latitude: Float!
    longitude: Float!
    place: String!
    countryCode: ID
  }

  input UpdateQuakeInput {
    time: DateTime
    magnitude: Float
    magnitudeType: String
    depthKm: Float
    latitude: Float
    longitude: Float
    place: String
    countryCode: ID
  }

  type Query {
    quakes(filter: QuakeFilter, sort: QuakeSort, page: PageInput): QuakePage!
    quakeStats(filter: QuakeFilter): QuakeStats!
  }

  type Mutation {
    createQuake(input: CreateQuakeInput!): Quake!
    updateQuake(id: ID!, input: UpdateQuakeInput!): Quake!
    deleteQuake(id: ID!): Boolean!
  }
`);
