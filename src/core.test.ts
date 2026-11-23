import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import { createCore, CoreError } from './core.ts';

const fresh = () => createCore(openDb(':memory:'));
const throwsCore = (fn: () => unknown, message: RegExp) =>
  assert.throws(fn, (err: unknown) => err instanceof CoreError && message.test(err.message));

describe('capture', () => {
  test('adds a trimmed item to the inbox', () => {
    const core = fresh();
    const task = core.capture('  Buy milk  ');
    assert.equal(task.title, 'Buy milk');
    assert.equal(task.status, 'inbox');
    assert.deepEqual(core.listInbox().map((t) => t.id), [task.id]);
  });

  test('rejects an empty title', () => {
    throwsCore(() => fresh().capture('   '), /Title can't be empty/);
  });
});

describe('processItem', () => {
  test('to next action, without a project', () => {
    const core = fresh();
    const { id } = core.capture('Call dentist');
    const result = core.processItem(id, { to: 'next' });
    assert.equal(result.to, 'next');
    assert.equal(core.listInbox().length, 0);
    assert.deepEqual(core.listNextActions().map((t) => t.id), [id]);
  });

  test('to next action, inside a project', () => {
    const core = fresh();
    const project = core.createProject('Move house', 'Living in the new place');
    const { id } = core.capture('Book van');
    core.processItem(id, { to: 'next', projectId: project.id });
    assert.deepEqual(core.listNextActions(project.id).map((t) => t.id), [id]);
  });

  test('to next action, unknown project fails and item stays in inbox', () => {
    const core = fresh();
    const { id } = core.capture('Book van');
    throwsCore(() => core.processItem(id, { to: 'next', projectId: 99 }), /Project 99 doesn't exist/);
    assert.equal(core.listInbox().length, 1);
  });

  test('to project: creates the project and removes the item', () => {
    const core = fresh();
    const { id } = core.capture('Plan trip');
    const result = core.processItem(id, { to: 'project', outcome: 'Flights and hotel booked' });
    assert.equal(result.to, 'project');
    assert.equal(core.listInbox().length, 0);
    const [project] = core.listProjects();
    assert.equal(project?.name, 'Plan trip');
    assert.equal(project?.outcome, 'Flights and hotel booked');
  });

  test('to project without an outcome fails and changes nothing', () => {
    const core = fresh();
    const { id } = core.capture('Plan trip');
    throwsCore(() => core.processItem(id, { to: 'project', outcome: ' ' }), /Outcome can't be empty/);
    assert.equal(core.listInbox().length, 1);
    assert.equal(core.listProjects().length, 0);
  });

  test('delete removes the item', () => {
    const core = fresh();
    const { id } = core.capture('Old idea');
    core.processItem(id, { to: 'delete' });
    assert.equal(core.listInbox().length, 0);
    throwsCore(() => core.processItem(id, { to: 'delete' }), /doesn't exist/);
  });

  test('only inbox items can be processed', () => {
    const core = fresh();
    const { id } = core.capture('Call dentist');
    core.processItem(id, { to: 'next' });
    throwsCore(() => core.processItem(id, { to: 'delete' }), /isn't in the inbox/);
  });
});

describe('completeTask', () => {
  test('marks a next action done', () => {
    const core = fresh();
    const { id } = core.capture('Call dentist');
    core.processItem(id, { to: 'next' });
    const done = core.completeTask(id);
    assert.equal(done.status, 'done');
    assert.ok(done.completed_at);
    assert.equal(core.listNextActions().length, 0);
  });

  test('refuses an inbox item', () => {
    const core = fresh();
    const { id } = core.capture('Call dentist');
    throwsCore(() => core.completeTask(id), /isn't a next action/);
  });

  test('refuses an unknown task', () => {
    throwsCore(() => fresh().completeTask(42), /Task 42 doesn't exist/);
  });
});

describe('projects', () => {
  test('create and list', () => {
    const core = fresh();
    const p = core.createProject(' Garden ', ' Beds planted ');
    assert.equal(p.name, 'Garden');
    assert.equal(p.status, 'active');
    assert.deepEqual(core.listProjects().map((x) => x.id), [p.id]);
  });

  test('name and outcome are required', () => {
    const core = fresh();
    throwsCore(() => core.createProject('', 'x'), /Name can't be empty/);
    throwsCore(() => core.createProject('x', ''), /Outcome can't be empty/);
  });

  test('listing next actions for an unknown project fails', () => {
    throwsCore(() => fresh().listNextActions(7), /Project 7 doesn't exist/);
  });
});
