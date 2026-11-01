import { Hono } from 'hono';
import { adminPage, publicPage } from './page';

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
type Row = {
  id: string; name: string; developer: string; description: string; version: string;
  category: string; icon: string; accent: string; apk_url: string; sha256: string;
  featured: number; created_at: string; updated_at: string;
};
const app = new Hono<{ Bindings: Bindings }>();
const categories = new Set(['Інструменти', 'Продуктивність', 'Освіта', 'Розваги', 'Інше']);
const idPattern = /^[a-z0-9][a-z0-9._-]{1,80}$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const shaPattern = /^[a-f0-9]{64}$/i;
const publicApp = (row: Row) => ({
  id: row.id, name: row.name, developer: row.developer, description: row.description,
  version: row.version, category: row.category, icon: row.icon, accent: row.accent,
  apkUrl: row.apk_url, sha256: row.sha256, featured: row.featured === 1,
  updatedAt: row.updated_at,
});
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
});
app.get('/', c => c.html(publicPage));
app.get('/admin', c => c.html(adminPage));
app.get('/api/health', c => c.json({ ok: true, service: 'Horanov Store', version: '0.4.9' }));
app.get('/api/apps', async c => {
  try {
    const rows = await c.env.DB.prepare('SELECT * FROM apps ORDER BY featured DESC, updated_at DESC, name ASC').all<Row>();
    return c.json({ apps: (rows.results ?? []).map(publicApp) });
  } catch { return c.json({ error: 'Database unavailable' }, 503); }
});
app.use('/api/admin/*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token || c.req.header('Authorization') !== `Bearer ${token}`) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});
app.get('/api/admin/apps', async c => {
  try {
    const rows = await c.env.DB.prepare('SELECT * FROM apps ORDER BY updated_at DESC').all<Row>();
    return c.json({ apps: (rows.results ?? []).map(publicApp) });
  } catch { return c.json({ error: 'Database unavailable' }, 503); }
});
type Payload = Record<string, unknown>;
function parsePayload(data: Payload): { value: Omit<Row, 'created_at' | 'updated_at'> } | { error: string } {
  const val = (field: string, fallback = '') => typeof data[field] === 'string' ? (data[field] as string).trim() : fallback;
  const id = val('id'); const name = val('name'); const version = val('version');
  const developer = val('developer', 'Horanov Labs'); const description = val('description');
  const icon = val('icon', name[0]?.toUpperCase() || 'H'); const accent = val('accent', '#F56B2A');
  const category = val('category', 'Інше'); const apkUrl = val('apkUrl'); const sha256 = val('sha256').toLowerCase();
  if (!idPattern.test(id)) return { error: 'Invalid app ID. Use a stable lowercase package-style ID, e.g. com.horanov.notes' };
  if (name.length < 2 || name.length > 100) return { error: 'Name must be 2–100 characters' };
  if (!version || version.length > 40 || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) return { error: 'Invalid version' };
  if (developer.length > 100 || description.length > 2500 || icon.length > 3) return { error: 'Text field too long' };
  if (!categories.has(category)) return { error: 'Unknown category' };
  if (!colorPattern.test(accent)) return { error: 'Accent must be a 6-digit color' };
  if (!shaPattern.test(sha256)) return { error: 'SHA-256 must be 64 hexadecimal characters' };
  try {
    const url = new URL(apkUrl);
    // The MVP uses public GitHub Releases (no private repositories or bearer tokens in mobile apps).
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+\.apk$/i.test(url.pathname)) {
      return { error: 'Use a public github.com/OWNER/REPO/releases/download/TAG/FILE.apk URL' };
    }
  } catch { return { error: 'Invalid APK URL' }; }
  return { value: { id, name, version, developer, description, icon, accent, category, apk_url: apkUrl, sha256, featured: data.featured === true ? 1 : 0 } };
}
app.post('/api/admin/apps', async c => {
  let data: unknown;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parsePayload(data as Payload);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;
  try {
    await c.env.DB.prepare(`INSERT INTO apps(id,name,version,developer,description,icon,accent,category,apk_url,sha256,featured)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,
      developer=excluded.developer,description=excluded.description,icon=excluded.icon,accent=excluded.accent,
      category=excluded.category,apk_url=excluded.apk_url,sha256=excluded.sha256,
      featured=excluded.featured,updated_at=datetime('now')`)
      .bind(v.id,v.name,v.version,v.developer,v.description,v.icon,v.accent,v.category,v.apk_url,v.sha256,v.featured).run();
    return c.json({ ok: true, id: v.id });
  } catch { return c.json({ error: 'Database write failed' }, 500); }
});
app.delete('/api/admin/apps/:id', async c => {
  const id = c.req.param('id');
  if (!idPattern.test(id)) return c.json({ error: 'Invalid app ID' }, 400);
  try { await c.env.DB.prepare('DELETE FROM apps WHERE id=?').bind(id).run(); return c.json({ ok: true }); }
  catch { return c.json({ error: 'Database delete failed' }, 500); }
});
app.notFound(c => c.json({ error: 'Not found' }, 404));
export default app;
