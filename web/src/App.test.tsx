import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClientEvents } from './lib/voice-client';

const mocks = vi.hoisted(() => ({ events: null as ClientEvents | null, sendText: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./components/Portrait', () => ({ Portrait: () => <div aria-label="Nhân vật" /> }));
vi.mock('./lib/voice-client', () => ({ VoiceClient: class {
  constructor(events: ClientEvents) { mocks.events = events; }
  disconnect = vi.fn().mockResolvedValue(undefined);
  connect = vi.fn(async () => { mocks.events?.link('connected'); mocks.events?.agent('listening'); });
  device = vi.fn().mockResolvedValue(undefined);
  sendText = mocks.sendText;
  microphoneEnabled() { return false; }
} }));
import App from './App';

beforeEach(() => {
  mocks.events = null; mocks.sendText.mockClear();
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
  expect(screen.getByRole('slider', { name: /Độ há hàm/ })).toHaveValue('1.2');
  expect(screen.queryByLabelText('SONIOX_API_KEY')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('places the composer in the chatbot and drafts a suggestion before connection', async () => {
  render(<App />);
  const chat = screen.getByRole('complementary', { name: 'Trò chuyện cùng trợ lý' });
  expect(within(chat).getByLabelText('Nội dung tin nhắn')).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nói chuyện với mình một chút nhé.' }));
  expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue('Nói chuyện với mình một chút nhé.');
  expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled();
  expect(mocks.sendText).not.toHaveBeenCalled();
});

it('sends chat after connecting and updates interim speech text in the same message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, auth_required: false, missing: [], providers: {}, language: 'vi' }))));
  render(<App />);
  await screen.findByText('Kết nối để gửi tin nhắn');
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' }));
  await screen.findByText('Đã kết nối');
  fireEvent.change(screen.getByLabelText('Nội dung tin nhắn'), { target: { value: 'Xin chào!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
  await waitFor(() => expect(mocks.sendText).toHaveBeenCalledWith('Xin chào!'));
  await waitFor(() => expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue(''));
  act(() => mocks.events?.message({ id: 'speech-1', role: 'user', text: 'Tôi muốn hỏi', final: false }));
  expect(screen.getByText('· Đang nhận giọng nói')).toBeInTheDocument();
  act(() => mocks.events?.message({ id: 'speech-1', role: 'user', text: 'Tôi muốn hỏi một câu.', final: true }));
  const log = screen.getByRole('log', { name: 'Nội dung hội thoại' });
  expect(within(log).getAllByRole('article')).toHaveLength(1);
  expect(within(log).getByText('Tôi muốn hỏi một câu.')).toBeInTheDocument();
  expect(screen.queryByText('· Đang nhận giọng nói')).not.toBeInTheDocument();
});
