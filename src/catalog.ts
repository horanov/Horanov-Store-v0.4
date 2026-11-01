export type Category = 'Інструменти' | 'Продуктивність' | 'Освіта' | 'Розваги' | 'Інше';
export type StoreApp = {
  id: string;
  name: string;
  developer: string;
  description: string;
  version: string;
  category: Category;
  icon: string;
  accent: string;
  apkUrl: string;
  sha256: string;
  featured: boolean;
};
export const CATEGORIES: Array<'Усі' | Category> = ['Усі', 'Інструменти', 'Продуктивність', 'Освіта', 'Розваги', 'Інше'];
// No seeded/demo apps: catalog is online-only.
