export type MacroNewsCategory = 'conflict' | 'health' | 'economy' | 'politics';

export interface MacroNewsArticle {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  category: MacroNewsCategory | string;
  image_url: string | null;
}

export interface MacroNewsResponse {
  articles: MacroNewsArticle[];
  updated_at: string;
  by_category: Record<string, number>;
  cached: boolean;
}

export async function getMacroNews(opts?: {
  categories?: MacroNewsCategory[];
  limit?: number;
}): Promise<MacroNewsResponse> {
  const params = new URLSearchParams();
  if (opts?.categories?.length) params.set('categories', opts.categories.join(','));
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/macro-news/feed${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MacroNewsResponse;
}
