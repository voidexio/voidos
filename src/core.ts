import type { Db } from './db.ts';

// ---- Types ----

export type TaskStatus = 'inbox' | 'next' | 'done';
export type ProjectStatus = 'active' | 'on_hold' | 'done';

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  project_id: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Project {
  id: number;
  name: string;
  outcome: string;
  status: ProjectStatus;
  created_at: string;
}

/** Where an inbox item goes when it's processed. */
export type Destination =
  | { to: 'next'; projectId?: number }
  | { to: 'project'; outcome: string }
  | { to: 'delete' };

export type ProcessResult =
  | { to: 'next'; task: Task }
  | { to: 'project'; project: Project }
  | { to: 'delete'; id: number };

/** A rule was broken. The message is safe to show to the user as-is. */
export class CoreError extends Error {
  override name = 'CoreError';
}

// ---- Helpers ----

const now = () => new Date().toISOString();

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CoreError(`${field} can't be empty`);
  return trimmed;
}

// ---- Core ----

export function createCore(db: Db) {
  const getTask = (id: number) =>
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;

  const getProject = (id: number) =>
    db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;

  function requireTask(id: number): Task {
    const task = getTask(id);
    if (!task) throw new CoreError(`Task ${id} doesn't exist`);
    return task;
  }

  function requireActiveProject(id: number): Project {
    const project = getProject(id);
    if (!project) throw new CoreError(`Project ${id} doesn't exist`);
    if (project.status !== 'active') throw new CoreError(`Project ${id} isn't active`);
    return project;
  }

  function insertProject(name: string, outcome: string): Project {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO projects (name, outcome, status, created_at) VALUES (?, ?, 'active', ?)")
      .run(required(name, 'Name'), required(outcome, 'Outcome'), now());
    return getProject(Number(lastInsertRowid))!;
  }

  return {
    /** Add an item to the inbox. */
    capture(title: string): Task {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO tasks (title, status, created_at) VALUES (?, 'inbox', ?)")
        .run(required(title, 'Title'), now());
      return getTask(Number(lastInsertRowid))!;
    },

    /** Unprocessed items, oldest first. */
    listInbox(): Task[] {
      return db
        .prepare("SELECT * FROM tasks WHERE status = 'inbox' ORDER BY created_at, id")
        .all() as Task[];
    },

    /** Send an inbox item to Next Actions, turn it into a project, or delete it. */
    processItem(id: number, dest: Destination): ProcessResult {
      const task = requireTask(id);
      if (task.status !== 'inbox') throw new CoreError(`Task ${id} isn't in the inbox`);

      switch (dest.to) {
        case 'next': {
          const projectId = dest.projectId ?? null;
          if (projectId !== null) requireActiveProject(projectId);
          db.prepare("UPDATE tasks SET status = 'next', project_id = ? WHERE id = ?").run(projectId, id);
          return { to: 'next', task: getTask(id)! };
        }
        case 'project': {
          const project = db.transaction(() => {
            const p = insertProject(task.title, dest.outcome);
            db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
            return p;
          })();
          return { to: 'project', project };
        }
        case 'delete': {
          db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
          return { to: 'delete', id };
        }
      }
    },

    /** Open next actions, optionally for one project. */
    listNextActions(projectId?: number): Task[] {
      if (projectId === undefined) {
        return db
          .prepare("SELECT * FROM tasks WHERE status = 'next' ORDER BY created_at, id")
          .all() as Task[];
      }
      if (!getProject(projectId)) throw new CoreError(`Project ${projectId} doesn't exist`);
      return db
        .prepare("SELECT * FROM tasks WHERE status = 'next' AND project_id = ? ORDER BY created_at, id")
        .all(projectId) as Task[];
    },

    /** Tick off a next action. */
    completeTask(id: number): Task {
      const task = requireTask(id);
      if (task.status !== 'next') throw new CoreError(`Task ${id} isn't a next action`);
      db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(now(), id);
      return getTask(id)!;
    },

    /** Projects that aren't done, oldest first. */
    listProjects(): Project[] {
      return db
        .prepare("SELECT * FROM projects WHERE status IN ('active', 'on_hold') ORDER BY created_at, id")
        .all() as Project[];
    },

    /** Add a project. Both name and outcome are required. */
    createProject(name: string, outcome: string): Project {
      return insertProject(name, outcome);
    },
  };
}

export type Core = ReturnType<typeof createCore>;
