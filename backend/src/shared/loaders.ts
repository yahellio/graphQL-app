import DataLoader from 'dataloader';

// DataLoader'ы живут один запрос и решают проблему N+1. В ключ входят аргументы поля,
// поэтому `quakes(page: {limit: 5})` для 20 стран выполняется одним SQL-запросом, а не двадцатью.
export class Loaders {
  private readonly loaders = new Map<string, DataLoader<string, unknown>>();

  get<V>(key: string, batch: (keys: readonly string[]) => Promise<V[]>): DataLoader<string, V> {
    let loader = this.loaders.get(key);
    if (!loader) {
      loader = new DataLoader<string, unknown>(batch);
      this.loaders.set(key, loader);
    }
    return loader as DataLoader<string, V>;
  }
}

export interface RequestContext {
  loaders: Loaders;
}

export const createContext = async (): Promise<RequestContext> => ({ loaders: new Loaders() });

// DataLoader ждёт результаты строго в порядке ключей.
export function groupBy<T>(keys: readonly string[], rows: T[], keyOf: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>(keys.map((k) => [k, []]));
  for (const row of rows) groups.get(keyOf(row))?.push(row);
  return keys.map((k) => groups.get(k)!);
}
