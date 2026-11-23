import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CoreError, type Core, type Destination } from '../core.ts';

/**
 * The web door, used by the React UI. Each route calls exactly one core function: no db access, no rules here.
 * Zod only checks the request's shape; a broken rule (CoreError) comes back as 400 with core's message.
 */
export function createApp(core: Core): Hono {
  const app = new Hono().basePath('/api');

  const id = z.coerce.number().int().positive();
  const idParam = z.object({ id });
  const captureBody = z.object({ title: z.string() });
  const projectBody = z.object({ name: z.string(), outcome: z.string() });
  const destinationBody = z.discriminatedUnion('to', [
    z.object({ to: z.literal('next'), projectId: z.number().int().positive().optional() }),
    z.object({ to: z.literal('project'), outcome: z.string() }),
    z.object({ to: z.literal('delete') }),
  ]);
  const nextActionsQuery = z.object({ projectId: id.optional() });

  /** Parse or throw a 400 with a readable message. */
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new HTTPException(400, { message: z.prettifyError(result.error) });
    return result.data;
  }

  /** Read the JSON body; a missing or broken body is a 400, not a 500. */
  async function body(req: Request): Promise<unknown> {
    try {
      return await req.json();
    } catch {
      throw new HTTPException(400, { message: 'Body must be valid JSON' });
    }
  }

  app.post('/inbox', async (c) => {
    const { title } = parse(captureBody, await body(c.req.raw));
    return c.json(core.capture(title), 201);
  });

  app.get('/inbox', (c) => c.json(core.listInbox()));

  app.post('/inbox/:id/process', async (c) => {
    const { id } = parse(idParam, c.req.param());
    const parsed = parse(destinationBody, await body(c.req.raw));
    // exactOptionalPropertyTypes: drop an absent projectId rather than pass `undefined`.
    const dest: Destination =
      parsed.to === 'next' && parsed.projectId === undefined ? { to: 'next' } : (parsed as Destination);
    return c.json(core.processItem(id, dest));
  });

  app.get('/next-actions', (c) => {
    const { projectId } = parse(nextActionsQuery, c.req.query());
    return c.json(core.listNextActions(projectId));
  });

  app.post('/tasks/:id/complete', (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(core.completeTask(id));
  });

  app.get('/projects', (c) => c.json(core.listProjects()));

  app.post('/projects', async (c) => {
    const { name, outcome } = parse(projectBody, await body(c.req.raw));
    return c.json(core.createProject(name, outcome), 201);
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    if (err instanceof CoreError) return c.json({ error: err.message }, 400);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
