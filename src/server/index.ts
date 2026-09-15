import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';
import { participantsRoute } from './routes/participants';
import { destinationsRoute } from './routes/destinations';
import { resultsRoute } from './routes/results';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));

app.route('/', eventsRoute);
app.route('/', participantsRoute);
app.route('/', destinationsRoute);
app.route('/', resultsRoute);

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

export default app;
