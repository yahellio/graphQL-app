import { parse } from 'graphql';

export const typeDefs = parse(/* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  enum SortOrder {
    ASC
    DESC
  }

  input PageInput {
    limit: Int = 20
    offset: Int = 0
  }

  # Сущность федерации: подграф quakes добавляет к стране поля quakes и quakeCount
  type Country @key(fields: "code") {
    code: ID!
    code3: String!
    name: String!
    region: String!
    incomeLevel: String!
    capital: String
    population: Float
    gdpUsd: Float
    gdpPerCapitaUsd: Float
    neighbours(limit: Int = 5): [Country!]!
  }

  type CountryPage {
    items: [Country!]!
    total: Int!
  }

  input CountryFilter {
    search: String
    regions: [String!]
  }

  enum CountrySortField {
    NAME
    POPULATION
    GDP
  }

  input CountrySort {
    field: CountrySortField! = NAME
    order: SortOrder! = ASC
  }

  type Query {
    countries(filter: CountryFilter, sort: CountrySort, page: PageInput): CountryPage!
    country(code: ID!): Country
    regions: [String!]!
  }
`);
