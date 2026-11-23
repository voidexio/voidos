import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CoreError, type Core, type Destination } from '../core.ts';

/**
 * The MCP door. Each tool calls exactly one core function: no db access, no rules here.
 * A broken rule (CoreError) comes back as a tool error Claude can read and recover from.
 */
export function createMcpServer(core: Core): McpServer {
  const server = new McpServer({ name: 'voidos', version: '0.1.0' });

  /** Run a core call and turn the outcome into a tool result. */
  function run(fn: () => unknown): CallToolResult {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(fn(), null, 2) }] };
    } catch (err) {
      if (err instanceof CoreError) return { isError: true, content: [{ type: 'text', text: err.message }] };
      throw err;
    }
  }

  const id = z.number().int().positive();
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'capture',
    {
      title: 'Capture',
      description: 'Add an item to the voidOS inbox. Title only; it gets processed later.',
      inputSchema: { title: z.string().describe('What is on your mind, in a few words') },
      annotations: { openWorldHint: false },
    },
    ({ title }) => run(() => core.capture(title)),
  );

  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description: 'Unprocessed inbox items, oldest first.',
      annotations: readOnly,
    },
    () => run(() => core.listInbox()),
  );

  server.registerTool(
    'process_item',
    {
      title: 'Process inbox item',
      description:
        'Decide what an inbox item is. "next": it becomes a next action (optionally inside an active project). ' +
        '"project": it becomes a project named after the item; outcome is required. "delete": it is removed for good.',
      inputSchema: {
        id: id.describe('Inbox item id'),
        destination: z.enum(['next', 'project', 'delete']),
        project_id: id.optional().describe('Only for "next": the project this action belongs to'),
        outcome: z.string().optional().describe('Only for "project": what done looks like'),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    ({ id, destination, project_id, outcome }) =>
      run(() => {
        const dest: Destination =
          destination === 'next'
            ? project_id === undefined ? { to: 'next' } : { to: 'next', projectId: project_id }
            : destination === 'project'
              ? { to: 'project', outcome: outcome ?? '' }
              : { to: 'delete' };
        return core.processItem(id, dest);
      }),
  );

  server.registerTool(
    'list_next_actions',
    {
      title: 'List next actions',
      description: 'Open next actions, oldest first. Pass project_id to see one project only.',
      inputSchema: { project_id: id.optional() },
      annotations: readOnly,
    },
    ({ project_id }) => run(() => core.listNextActions(project_id)),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Tick off a next action.',
      inputSchema: { id: id.describe('Next action id') },
      annotations: { idempotentHint: false, openWorldHint: false },
    },
    ({ id }) => run(() => core.completeTask(id)),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects that are not done (active and on hold), oldest first.',
      annotations: readOnly,
    },
    () => run(() => core.listProjects()),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Add a project directly. Both name and outcome (what done looks like) are required.',
      inputSchema: { name: z.string(), outcome: z.string().describe('What done looks like') },
      annotations: { openWorldHint: false },
    },
    ({ name, outcome }) => run(() => core.createProject(name, outcome)),
  );

  return server;
}
