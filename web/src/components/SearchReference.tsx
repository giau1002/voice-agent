import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { ArrowUpRight, Globe2 } from 'lucide-react';
import type { WebLookup } from '../lib/web-search';

export function SearchSuggestions({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    // Keep the provider's search-chip styling scoped to this block. Sanitize
    // active content before insertion; no scripts or global styles can run.
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' });
    root.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true }, ADD_TAGS: ['style'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'foreignObject', 'animate', 'set'],
    });
    root.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
    return () => { root.innerHTML = ''; };
  }, [html]);
  return <div ref={host} className="search-suggestions" aria-label="Gợi ý tìm kiếm Google" />;
}

export function SearchReference({ lookup }: { lookup: WebLookup }) {
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(lookup.checked_at));
  return <article className="search-reference" aria-label="Kết quả tra cứu web">
    <div className="search-reference-heading"><Globe2 size={14} /><span>Đã tra cứu web</span><time dateTime={lookup.checked_at}>{time}</time></div>
    <details><summary>{lookup.query}</summary><p className="search-answer">{lookup.answer}</p></details>
    <div className="source-links" aria-label="Nguồn tham khảo">{lookup.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span>{index + 1}</span>{source.title}<ArrowUpRight size={11} /></a>)}</div>
    {lookup.suggestions_html && <SearchSuggestions html={lookup.suggestions_html} />}
  </article>;
}
