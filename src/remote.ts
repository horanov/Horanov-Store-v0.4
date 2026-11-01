import { API_BASE_URL } from './config';
import type { StoreApp, Category } from './catalog';
const CATEGORIES: Category[] = ['Інструменти', 'Продуктивність', 'Освіта', 'Розваги', 'Інше'];
const color = /^#[0-9a-f]{6}$/i;
const hex256 = /^[0-9a-f]{64}$/i;
function parseApp(input: unknown): StoreApp | null {
  if (!input || typeof input !== 'object') return null;
  const x = input as Record<string, unknown>;
  if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.version !== 'string' ||
      typeof x.apkUrl !== 'string' || typeof x.sha256 !== 'string' || !hex256.test(x.sha256)) return null;
  try {
    const uri = new URL(x.apkUrl);
    if (uri.protocol !== 'https:' || uri.username || uri.password) return null;
  } catch { return null; }
  return {
    id: x.id,
    name: x.name.slice(0, 100),
    version: x.version,
    developer: typeof x.developer === 'string' ? x.developer : 'Horanov Labs',
    description: typeof x.description === 'string' ? x.description : '',
    category: CATEGORIES.includes(x.category as Category) ? x.category as Category : 'Інше',
    icon: typeof x.icon === 'string' ? x.icon.slice(0, 3) : x.name[0]?.toUpperCase() ?? 'H',
    accent: typeof x.accent === 'string' && color.test(x.accent) ? x.accent : '#F56B2A',
    apkUrl: x.apkUrl,
    sha256: x.sha256.toLowerCase(),
    featured: x.featured === true,
  };
}
export async function fetchCatalog(): Promise<StoreApp[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_BASE_URL}/api/apps`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as { apps?: unknown }).apps)) throw new Error('Невірний формат відповіді сервера');
    const apps = (data as { apps: unknown[] }).apps.map(parseApp);
    return apps.filter((app): app is StoreApp => app !== null);
  } finally { clearTimeout(timeout); }
}
