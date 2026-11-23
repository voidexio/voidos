import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb, DEFAULT_DB_PATH } from '../db.ts';
import { createCore } from '../core.ts';
import { createMcpServer } from './server.ts';

// stdout is the MCP channel: log to stderr only.
const server = createMcpServer(createCore(openDb()));
await server.connect(new StdioServerTransport());
console.error(`voidos MCP server running (db: ${DEFAULT_DB_PATH})`);
