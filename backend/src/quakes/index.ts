import { startSubgraph } from '../shared/server';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';

void startSubgraph('quakes', Number(process.env.PORT ?? 4002), typeDefs, resolvers);
