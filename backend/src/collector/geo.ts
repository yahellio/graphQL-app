// Страну определяем по тексту места: "144 km SE of Hasaki, Japan", "OFF EAST COAST OF KAMCHATKA".
// Берём самое длинное совпадение, чтобы "PAPUA NEW GUINEA" не превратилась в "GUINEA".

const US_STATES = [
  'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO', 'CONNECTICUT', 'DELAWARE', 'FLORIDA', 'HAWAII',
  'IDAHO', 'ILLINOIS', 'INDIANA', 'IOWA', 'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE', 'MARYLAND', 'MASSACHUSETTS',
  'MICHIGAN', 'MINNESOTA', 'MISSISSIPPI', 'MISSOURI', 'MONTANA', 'NEBRASKA', 'NEVADA', 'NEW HAMPSHIRE', 'NEW JERSEY',
  'NEW MEXICO', 'NEW YORK', 'NORTH CAROLINA', 'NORTH DAKOTA', 'OHIO', 'OKLAHOMA', 'OREGON', 'PENNSYLVANIA',
  'RHODE ISLAND', 'SOUTH CAROLINA', 'SOUTH DAKOTA', 'TENNESSEE', 'TEXAS', 'UTAH', 'VERMONT', 'VIRGINIA', 'WASHINGTON',
  'WEST VIRGINIA', 'WISCONSIN', 'WYOMING', // без GEORGIA: так называется и страна
];

const US_STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '),
);

// Регионы и привычные названия, которых нет в списке World Bank
const ALIASES: Record<string, string[]> = {
  US: ['UNITED STATES', 'USA', 'ALEUTIAN', 'ALEUTIAN IS', 'ALEUTIAN ISLANDS', 'GULF OF ALASKA', ...US_STATES],
  MX: ['GULF OF CALIFORNIA', 'BAJA CALIFORNIA', 'REVILLA GIGEDO'],
  RU: ['RUSSIA', 'KAMCHATKA', 'KURIL', 'KURIL ISLANDS', 'KOMANDORSKIYE', 'SAKHALIN', 'SIBERIA', 'SEA OF OKHOTSK'],
  JP: ['HONSHU', 'HOKKAIDO', 'KYUSHU', 'SHIKOKU', 'RYUKYU', 'RYUKYU ISLANDS', 'IZU ISLANDS', 'BONIN ISLANDS', 'VOLCANO ISLANDS'],
  ID: ['SAVU SEA', 'CELEBES SEA', 'SUMATRA', 'JAVA', 'SULAWESI', 'MOLUCCA', 'MOLUCCA SEA', 'HALMAHERA', 'BANDA SEA', 'FLORES', 'FLORES SEA', 'SUMBAWA', 'BALI', 'LOMBOK', 'SERAM', 'TALAUD'],
  PH: ['PHILIPPINE', 'PHILIPPINE ISLANDS', 'MINDANAO', 'LUZON', 'MINDORO', 'SAMAR', 'LEYTE'],
  CN: ['XINJIANG', 'XIZANG', 'TIBET', 'SICHUAN', 'YUNNAN', 'QINGHAI', 'GANSU'],
  NZ: ['N Z', 'KERMADEC', 'KERMADEC ISLANDS'],
  PG: ['P N G', 'PNG', 'NEW GUINEA', 'NEW BRITAIN', 'NEW IRELAND', 'BOUGAINVILLE', 'ADMIRALTY ISLANDS'],
  CL: ['EASTER ISLAND'],
  EC: ['GALAPAGOS'],
  PT: ['AZORES', 'MADEIRA'],
  ES: ['CANARY ISLANDS'],
  NO: ['SVALBARD', 'JAN MAYEN'],
  GR: ['CRETE', 'DODECANESE', 'AEGEAN SEA'],
  NC: ['LOYALTY ISLANDS'],
  SB: ['SANTA CRUZ ISLANDS'],
  CA: ['HAIDA GWAII', 'BRITISH COLUMBIA'],
  IT: ['SICILY', 'SARDINIA'],
  AF: ['HINDU KUSH'],
  MP: ['MARIANA ISLANDS'],
  TR: ['TURKEY'],
  MM: ['BURMA'],
  KR: ['SOUTH KOREA'],
  KP: ['NORTH KOREA'],
  LA: ['LAOS'],
  VN: ['VIETNAM'],
  KG: ['KYRGYZSTAN'],
  SK: ['SLOVAKIA'],
  SY: ['SYRIA'],
  TL: ['EAST TIMOR'],
  HK: ['HONG KONG'],
  CD: ['DEMOCRATIC REPUBLIC OF THE CONGO', 'DR CONGO'],
  CG: ['REPUBLIC OF THE CONGO'],
};

// Содержат название страны, но к ней не относятся
const NO_COUNTRY = ['SOUTH GEORGIA', 'SOUTH SANDWICH ISLANDS', 'INDIAN OCEAN', 'INDIAN ANTARCTIC RIDGE'];

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

// "Korea, Rep." -> ["KOREA REP", "KOREA"]
const baseNames = (name: string): string[] => {
  const withoutParens = name.replace(/\(.*?\)/g, '');
  return [...new Set([normalize(withoutParens), normalize(withoutParens.split(',')[0])])];
};

export class CountryMatcher {
  private readonly names: [string, string][]; // от длинных имён к коротким; пустой код = «не страна»

  constructor(countries: { code: string; name: string }[]) {
    const known = new Set(countries.map((c) => c.code));
    const map = new Map<string, string | null>();
    for (const c of countries) {
      for (const n of baseNames(c.name)) {
        // "CONGO" есть у двух стран, такие имена пропускаем
        map.set(n, map.has(n) && map.get(n) !== c.code ? null : c.code);
      }
    }
    for (const [code, aliases] of Object.entries(ALIASES)) {
      if (known.has(code)) for (const a of aliases) map.set(normalize(a), code);
    }
    for (const phrase of NO_COUNTRY) map.set(phrase, '');

    this.names = [...map.entries()]
      .filter((e): e is [string, string] => e[1] !== null && e[0].length > 0)
      .sort((a, b) => b[0].length - a[0].length);
  }

  match(place: string): string | null {
    const suffix = place.split(',').pop()!.trim();
    if (US_STATE_CODES.has(suffix)) return 'US'; // USGS пишет штаты сокращённо: "..., CA"
    if (suffix === 'MX') return 'MX';

    const text = ` ${normalize(place)} `;
    for (const [name, code] of this.names) {
      if (text.includes(` ${name} `)) return code || null;
    }
    return null;
  }
}
