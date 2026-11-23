import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { openDb } from '../db.ts';
import { createCore } from '../core.ts';
import { createMcpServer } from './server.ts';

/** A real MCP client talking to the server over an in-memory link, with an in-memory db. */
async function connect() {
  const server = createMcpServer(createCore(openDb(':memory:')));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = result.content[0];
    const text = first?.type === 'text' ? first.text : '';
    return { isError: result.isError === true, text };
  }
  /** Call a tool that should succeed and parse its JSON result. */
  async function ok(name: string, args: Record<string, unknown> = {}) {
    const { isError, text } = await call(name, args);
    assert.equal(isError, false, `${name} failed: ${text}`);
    return JSON.parse(text);
  }
  return { client, call, ok };
}

describe('mcp server', () => {
  test('exposes the seven tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'capture',
      'complete_task',
      'create_project',
      'list_inbox',
      'list_next_actions',
      'list_projects',
      'process_item',
    ]);
  });

  test('capture then list_inbox', async () => {
    const { ok } = await connect();
    const task = await ok('capture', { title: 'Buy milk' });
    assert.equal(task.status, 'inbox');
    const inbox = await ok('list_inbox');
    assert.deepEqual(inbox.map((t: { id: number }) => t.id), [task.id]);
  });

  test('process to next action inside a project, then complete it', async () => {
    const { ok } = await connect();
    const project = await ok('create_project', { name: 'Move house', outcome: 'Living in the new place' });
    const { id } = await ok('capture', { title: 'Book van' });
    const result = await ok('process_item', { id, destination: 'next', project_id: project.id });
    assert.equal(result.to, 'next');
    assert.deepEqual((await ok('list_next_actions', { project_id: project.id })).map((t: { id: number }) => t.id), [id]);
    const done = await ok('complete_task', { id });
    assert.equal(done.status, 'done');
    assert.deepEqual(await ok('list_next_actions'), []);
  });

  test('process to project', async () => {
    const { ok } = await connect();
    const { id } = await ok('capture', { title: 'Plan trip' });
    const result = await ok('process_item', { id, destination: 'project', outcome: 'Flights booked' });
    assert.equal(result.project.name, 'Plan trip');
    assert.equal((await ok('list_projects')).length, 1);
    assert.deepEqual(await ok('list_inbox'), []);
  });

  test('process to delete', async () => {
    const { ok } = await connect();
    const { id } = await ok('capture', { title: 'Nah' });
    assert.deepEqual(await ok('process_item', { id, destination: 'delete' }), { to: 'delete', id });
    assert.deepEqual(await ok('list_inbox'), []);
  });

  test('a broken core rule comes back as a readable tool error', async () => {
    const { ok, call } = await connect();
    const { id } = await ok('capture', { title: 'Plan trip' });
    const noOutcome = await call('process_item', { id, destination: 'project' });
    assert.equal(noOutcome.isError, true);
    assert.match(noOutcome.text, /Outcome can't be empty/);
    const notNext = await call('complete_task', { id });
    assert.equal(notNext.isError, true);
    assert.match(notNext.text, /isn't a next action/);
  });
});
