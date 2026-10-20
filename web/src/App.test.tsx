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
