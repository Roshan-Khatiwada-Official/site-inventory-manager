import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { readAppData, writeAppData } from './lib/sync.js';
import { prisma } from './lib/prisma.js';
import { verifyPassword } from './lib/auth.js';
import { ROLE_FROM_DB } from './lib/enums.js';
import { sitesRouter } from './routes/sites.js';
import { inventoryRouter } from './routes/inventory.js';
import { assignmentsRouter } from './routes/assignments.js';
import { requestsRouter } from './routes/requests.js';
import { usersRouter } from './routes/users.js';

const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const API_TOKEN = process.env.API_TOKEN || '';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '25mb' })); // whole-dataset payloads can be sizeable

// Same shared-secret model the old Google Sheets bridge used — the token is
// still shipped in the frontend bundle (anyone who can open the app can
// call the API), so it's a barrier against random internet scanners, not a
// substitute for real per-user auth. Skipped entirely if API_TOKEN is unset
// (local dev), so this is a no-op until a token is actually configured.
app.use((req, res, next) => {
  if (!API_TOKEN || req.path === '/health') return next();
  const provided = req.header('x-api-token') || (req.body && req.body.token);
  if (provided !== API_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized: bad token' });
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// Checks credentials server-side and never returns a password (hashed or
// not) to the client, unlike the old model of shipping the whole users
// table — including every password — to the browser just so it could check
// the login form locally.
app.post('/api/auth/login', async (req, res) => {
  try {
    const loginId = String(req.body?.loginId || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!loginId || !password) {
      return res.status(400).json({ ok: false, error: 'Login ID and password are required.' });
    }

    const user = await prisma.user.findFirst({
      where: { loginId: { equals: loginId, mode: 'insensitive' } },
    });
    if (!user) {
      return res.status(401).json({ ok: false, error: `No account found with Login ID "${req.body?.loginId}". Please contact the system administrator to obtain access.` });
    }
    if (user.status === 'Suspended') {
      return res.status(403).json({ ok: false, error: `Account "${req.body?.loginId}" is currently suspended. Please contact your system administrator.` });
    }
    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Incorrect password. Please verify your credentials or contact the administrator.' });
    }

    res.json({
      ok: true,
      user: {
        id: user.id, loginId: user.loginId, password: '', name: user.name,
        role: ROLE_FROM_DB[user.role], status: user.status, phone: user.phone,
        email: user.email, address: user.address, notes: user.notes,
        createdAt: user.createdAt, updatedAt: user.updatedAt, lastLogin: user.lastLogin ?? undefined,
      },
    });
  } catch (err) {
    console.error('POST /api/auth/login failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Read-only bulk fetch — the initial load and the background poll (which
// only ever reads; every actual write goes through the granular routes
// below, one request per action, each with its own validation and its own
// immediate success/failure response).
app.get('/api/data', async (_req, res) => {
  try {
    const data = await readAppData();
    res.json({ ok: true, data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('GET /api/data failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Bulk overwrite — kept only for the backup/import scripts (db:import-backup),
// not used by the frontend, which writes through the granular routes below.
app.post('/api/data', async (req, res) => {
  try {
    await writeAppData(req.body?.data ?? req.body);
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('POST /api/data failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.use('/api/sites', sitesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/users', usersRouter);

app.listen(PORT, () => {
  console.log(`siteops-backend listening on http://localhost:${PORT}`);
});
