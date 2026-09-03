// =====================================================================================
// Server entrypoint.
// Run with: node backend/src/server.mts   (or `npm start` from repo root, see package.json)
// =====================================================================================
import { App } from './lib/http.mts';
import { migrate } from './db/connection.mts';
import { SettingsRepo } from './repositories/adminRepo.mts';
import { attachUser } from './middleware/auth.mts';
import { registerAuthRoutes } from './routes/authRoutes.mts';
import { registerRegistryRoutes } from './routes/registryRoutes.mts';
import { registerCaseRoutes } from './routes/caseRoutes.mts';
import { registerDashboardRoutes } from './routes/dashboardRoutes.mts';
import { registerOpsRoutes } from './routes/opsRoutes.mts';
import { registerAdminRoutes } from './routes/adminRoutes.mts';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

migrate();
SettingsRepo.ensureDefaults();

const app = new App();
app.use(attachUser);

registerAuthRoutes(app);
registerRegistryRoutes(app);
registerCaseRoutes(app);
registerDashboardRoutes(app);
registerOpsRoutes(app);
registerAdminRoutes(app);

app.get('/api/health', (req, res) => { res.json({ status: 'ok', service: 'assam-biosecurity-backend', time: new Date().toISOString() }); });

// ---------------------------------------------------------------------------
// Static frontend serving (pilot serves the frontend from the same process /
// same port for simplicity -- see README for the docker-compose two-service option).
// ---------------------------------------------------------------------------
const FRONTEND_DIR = join(__dirname, '..', '..', 'frontend', 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// Any GET/HEAD that doesn't match an /api/* route falls through to the static frontend
// (single-page app: unknown paths serve index.html so client-side routing works).
app.setNotFoundHandler((req, res) => {
  const urlPath = (req.url?.split('?')[0]) || '/';
  if (urlPath.startsWith('/api/')) { res.status(404).json({ error: 'Not found', path: urlPath }); return; }
  serveStatic(urlPath, res);
});

function serveStatic(urlPath: string, res: any) {
  let filePath = join(FRONTEND_DIR, urlPath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(FRONTEND_DIR, 'index.html');
  const ext = extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`\nAssam Livestock Biosecurity & Disease Contact-Tracing Platform`);
  console.log(`Backend + frontend serving on http://localhost:${PORT}`);
  console.log(`API health check: http://localhost:${PORT}/api/health\n`);
});
