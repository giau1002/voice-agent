export interface WebLookup {
  query: string;
  answer: string;
  sources: { title: string; url: string }[];
  suggestions_html: string;
  checked_at: string;
}

export function parseWebLookup(value: unknown): WebLookup | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.status !== 'ok' || typeof data.query !== 'string' || typeof data.answer !== 'string'
    || typeof data.checked_at !== 'string' || !Number.isFinite(Date.parse(data.checked_at))
    || typeof data.suggestions_html !== 'string' || data.suggestions_html.length > 100000
    || data.answer.length > 16000 || !Array.isArray(data.sources)) return null;
  const sources = data.sources.filter((source): source is { title: string; url: string } => {
    if (!source || typeof source.title !== 'string' || typeof source.url !== 'string') return false;
    try { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username; }
    catch { return false; }
  }).slice(0, 20);
  if (!sources.length) return null;
  return { query: data.query.slice(0, 500), answer: data.answer, sources,
    suggestions_html: data.suggestions_html, checked_at: data.checked_at };
}
