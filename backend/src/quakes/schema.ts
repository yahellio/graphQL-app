import { parse } from 'graphql';

export const typeDefs = parse(/* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  scalar DateTime

  enum SortOrder {
    ASC
    DESC
  }

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
    country: Country
  }

  type QuakePage {
    items: [Quake!]!
    total: Int!
  }

  input QuakeFilter {
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

  # Страна принадлежит подграфу countries, здесь мы только добавляем к ней поля
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
