import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.ts';
import { createCore } from '../core.ts';
import { createApp } from './app.ts';

/** The real app with an in-memory db, called without opening a port. */
function connect() {
  const app = createApp(createCore(openDb(':memory:')));

  async function call(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await app.request(`/api${path}`, init);
    return { status: res.status, json: await res.json() };
  }
  /** A call that should succeed; returns the parsed body. */
  async function ok(method: string, path: string, body?: unknown) {
    const { status, json } = await call(method, path, body);
    assert.ok(status < 300, `${method} ${path} failed (${status}): ${JSON.stringify(json)}`);
    return json;
  }
  return { call, ok };
}

describe('web api', () => {
  test('capture then list inbox', async () => {
    const { call, ok } = connect();
    const { status, json: task } = await call('POST', '/inbox', { title: 'Buy milk' });
    assert.equal(status, 201);
    assert.equal(task.status, 'inbox');
    const inbox = await ok('GET', '/inbox');
    assert.deepEqual(inbox.map((t: { id: number }) => t.id), [task.id]);
  });

  test('process to next action inside a project, then complete it', async () => {
    const { ok } = connect();
    const project = await ok('POST', '/projects', { name: 'Move house', outcome: 'Living in the new place' });
    const { id } = await ok('POST', '/inbox', { title: 'Book van' });
    const result = await ok('POST', `/inbox/${id}/process`, { to: 'next', projectId: project.id });
    assert.equal(result.to, 'next');
    assert.equal(result.task.project_id, project.id);

    const forProject = await ok('GET', `/next-actions?projectId=${project.id}`);
    assert.deepEqual(forProject.map((t: { id: number }) => t.id), [id]);

    const done = await ok('POST', `/tasks/${id}/complete`);
    assert.equal(done.status, 'done');
    assert.deepEqual(await ok('GET', '/next-actions'), []);
  });

  test('process to next action without a project', async () => {
    const { ok } = connect();
    const { id } = await ok('POST', '/inbox', { title: 'Call mum' });
    const result = await ok('POST', `/inbox/${id}/process`, { to: 'next' });
    assert.equal(result.task.project_id, null);
  });

  test('process into a project', async () => {
    const { ok } = connect();
    const { id } = await ok('POST', '/inbox', { title: 'Plan trip' });
    const result = await ok('POST', `/inbox/${id}/process`, { to: 'project', outcome: 'Tickets booked' });
    assert.equal(result.project.name, 'Plan trip');
    const projects = await ok('GET', '/projects');
    assert.deepEqual(projects.map((p: { id: number }) => p.id), [result.project.id]);
    assert.deepEqual(await ok('GET', '/inbox'), []);
  });

  test('process delete', async () => {
    const { ok } = connect();
    const { id } = await ok('POST', '/inbox', { title: 'Nah' });
    assert.deepEqual(await ok('POST', `/inbox/${id}/process`, { to: 'delete' }), { to: 'delete', id });
    assert.deepEqual(await ok('GET', '/inbox'), []);
  });

  test('a broken core rule is a 400 with core message', async () => {
    const { call } = connect();
    assert.deepEqual(await call('POST', '/inbox', { title: '   ' }), {
      status: 400,
      json: { error: "Title can't be empty" },
    });
    assert.deepEqual(await call('POST', '/tasks/99/complete'), {
      status: 400,
      json: { error: "Task 99 doesn't exist" },
    });
  });

  test('a bad request shape is a 400', async () => {
    const { call } = connect();
    for (const [method, path, body] of [
      ['POST', '/inbox', {}],
      ['POST', '/inbox', 'not json'],
      ['POST', '/tasks/abc/complete', undefined],
      ['POST', '/inbox/1/process', { to: 'somewhere' }],
      ['GET', '/next-actions?projectId=x', undefined],
    ] as const) {
      const { status, json } = await call(method, path, body);
      assert.equal(status, 400, `${method} ${path}`);
      assert.equal(typeof json.error, 'string');
    }
  });

  test('unknown route is a 404', async () => {
    const { call } = connect();
    assert.deepEqual(await call('GET', '/nope'), { status: 404, json: { error: 'Not found' } });
  });
});
