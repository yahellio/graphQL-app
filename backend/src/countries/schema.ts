import { parse } from 'graphql';

/** Подграф «countries»: справочник стран (источник — World Bank API). */
export const typeDefs = parse(/* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  enum SortOrder {
    ASC
    DESC
  }

  "Пагинация: limit ограничен 100 записями на странице."
  input PageInput {
    limit: Int = 20
    offset: Int = 0
  }

  "Страна. Сущность федерации: подграф quakes расширяет её полями о землетрясениях."
  type Country @key(fields: "code") {
    "ISO 3166-1 alpha-2"
    code: ID!
    "ISO 3166-1 alpha-3"
    code3: String!
    name: String!
    region: String!
    incomeLevel: String!
    capital: String
    population: Float
    gdpUsd: Float
    "Вычисляемое поле: ВВП на душу населения"
    gdpPerCapitaUsd: Float
    "Ближайшие страны по координатам столиц (вложенный список стран)"
    neighbours(limit: Int = 5): [Country!]!
  }

  type CountryPage {
    items: [Country!]!
    total: Int!
  }

  input CountryFilter {
    "Поиск по названию (подстрока, без учёта регистра)"
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
