import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./components/Portrait', () => ({ Portrait: () => <div aria-label="Nhân vật" /> }));
vi.mock('./lib/voice-client', () => ({ VoiceClient: class {
  disconnect = vi.fn().mockResolvedValue(undefined);
  connect = vi.fn().mockResolvedValue(undefined);
  device = vi.fn().mockResolvedValue(undefined);
  microphoneEnabled() { return false; }
} }));
import App from './App';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: false, auth_required: false, missing: ['SONIOX_API_KEY'], providers: {}, language: 'vi' }))));
});

it('clearly blocks connection until server has real credentials', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Bắt đầu trò chuyện/ })).toBeDisabled());
  expect(screen.getByText('SONIOX_API_KEY')).toBeInTheDocument();
  expect(screen.getByLabelText('Nội dung tin nhắn')).toBeInTheDocument();
});

it('opens hardware and portrait settings, changes motion, and keeps API keys out of the UI', async () => {
  render(<App />);
  fireEvent.click(screen.getByLabelText('Mở cài đặt'));
  const dialog = screen.getByRole('dialog'); expect(dialog).toBeInTheDocument();
  const motion = screen.getByLabelText('Cử động đầu khi nói');
  expect(motion).toBeChecked(); fireEvent.click(motion); expect(motion).not.toBeChecked();
  expect(screen.getByLabelText('Microphone')).toBeInTheDocument();
  expect(screen.queryByLabelText('SONIOX_API_KEY')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('finds procedures without accents, supports clear, and drafts a question before connection', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Tìm kiếm' }));
  const search = screen.getByLabelText('Tìm thủ tục');
  fireEvent.change(search, { target: { value: 'dang ky ket hon' } });
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Thủ tục đăng ký kết hôn/ }));
  expect((screen.getByLabelText('Nội dung tin nhắn') as HTMLTextAreaElement).value).toContain('Thủ tục đăng ký kết hôn');
  expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled();
  fireEvent.change(search, { target: { value: 'khong co ket qua' } });
  expect(screen.getByText('Chưa tìm thấy thủ tục')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Xóa tìm kiếm'));
  expect(search).toHaveValue('');
  expect(screen.queryByText('Chưa tìm thấy thủ tục')).not.toBeInTheDocument();
});

it('uses the forms tab to draft a form question and preserves it when collapsing chat', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Mẫu đơn' }));
  fireEvent.click(screen.getByRole('button', { name: /Thủ tục đăng ký kết hôn/ }));
  const message = screen.getByLabelText('Nội dung tin nhắn') as HTMLTextAreaElement;
  expect(message.value).toContain('mẫu đơn');
  const toggle = screen.getByRole('button', { name: 'NỘI DUNG TRÒ CHUYỆN' });
  fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle); expect(message).toBeVisible();
  expect(message.value).toContain('mẫu đơn');
});
