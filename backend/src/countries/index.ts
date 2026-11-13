import { startSubgraph } from '../shared/server';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';

void startSubgraph('countries', Number(process.env.PORT ?? 4001), typeDefs, resolvers);
