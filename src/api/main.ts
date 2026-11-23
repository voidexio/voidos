import { serve } from '@hono/node-server';
import { openDb, DEFAULT_DB_PATH } from '../db.ts';
import { createCore } from '../core.ts';
import { createApp } from './app.ts';

const port = Number(process.env['PORT'] ?? 8787);
const app = createApp(createCore(openDb()));

serve({ fetch: app.fetch, port }, (info) => {
  console.error(`voidos API on http://localhost:${info.port}/api (db: ${DEFAULT_DB_PATH})`);
});
