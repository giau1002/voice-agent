import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { parseWebLookup } from '../lib/web-search';
import { SearchReference, SearchSuggestions } from './SearchReference';

it('accepts verified sources but rejects executable URLs or malformed lookups', () => {
  const data = { status: 'ok', query: 'Câu hỏi', answer: 'Kết quả', checked_at: '2026-10-20T19:00:00+07:00',
    suggestions_html: '', sources: [{ title: 'Nguồn', url: 'javascript:alert(1)' }] };
  expect(parseWebLookup(data)).toBeNull();
  expect(parseWebLookup({ ...data, sources: [{ title: 'Nguồn', url: 'https://example.gov.vn' }] })?.sources).toHaveLength(1);
  expect(parseWebLookup({ ...data, checked_at: 'not a date' })).toBeNull();
});

it('keeps provider search suggestions scoped and removes executable markup', () => {
  render(<SearchSuggestions html={'<div><style>a{color:blue}</style><a href="https://google.com/search?q=test">Google</a><img src="x" onerror="alert(1)"><script>alert(1)</script></div>'} />);
  const root = screen.getByLabelText('Gợi ý tìm kiếm Google').shadowRoot!;
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('img')).not.toHaveAttribute('onerror');
  expect(root.querySelector('a')).toHaveAttribute('href', 'https://google.com/search?q=test');
  expect(root.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(root.querySelector('style')).not.toBeNull();
  expect(document.querySelector('style')).toBeNull();
});

it('shows the actual source links with a Vietnam-time lookup timestamp', () => {
  render(<SearchReference lookup={{ query: 'Thời tiết Hà Nội', answer: 'Thông tin từ nguồn.',
    checked_at: '2026-10-20T12:00:00Z', suggestions_html: '',
    sources: [{ title: 'Nguồn khí tượng', url: 'https://example.gov.vn/weather' }] }} />);
  expect(screen.getByRole('link', { name: /Nguồn khí tượng/ })).toHaveAttribute('href', 'https://example.gov.vn/weather');
  expect(screen.getByText(/19:00/)).toHaveTextContent('20/10/2026');
});
