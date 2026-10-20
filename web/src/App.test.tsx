import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClientEvents } from './lib/voice-client';

const mocks = vi.hoisted(() => ({ events: null as ClientEvents | null, connect: vi.fn(), sendText: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./components/Portrait', () => ({ Portrait: () => <div aria-label="Nhân vật" /> }));
vi.mock('./lib/voice-client', () => ({ VoiceClient: class {
  constructor(events: ClientEvents) { mocks.events = events; }
  disconnect = vi.fn().mockResolvedValue(undefined);
  connect = vi.fn(async (access: string, mic: boolean, input: string) => { mocks.connect(access, mic, input); mocks.events?.link('connected'); mocks.events?.agent('listening'); });
  device = vi.fn().mockResolvedValue(undefined);
  sendText = mocks.sendText;
  microphoneEnabled() { return false; }
} }));
import App from './App';

beforeEach(() => {
  mocks.events = null; mocks.sendText.mockClear(); mocks.connect.mockClear();
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
  const chat = screen.getByRole('complementary', { name: 'Trợ lý AI' });
  expect(within(chat).getByLabelText('Nội dung tin nhắn')).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Tra cứu hồ sơ/ }));
  expect((screen.getByLabelText('Nội dung tin nhắn') as HTMLTextAreaElement).value).toContain('hướng dẫn cách tra cứu');
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
  expect(screen.getByText('Đang nhận giọng nói')).toBeInTheDocument();
  act(() => mocks.events?.message({ id: 'speech-1', role: 'user', text: 'Tôi muốn hỏi một câu.', final: true }));
  const log = screen.getByRole('log', { name: 'Nội dung hội thoại' });
  expect(within(log).getAllByRole('article')).toHaveLength(1);
  expect(within(log).getByText('Tôi muốn hỏi một câu.')).toBeInTheDocument();
  expect(screen.queryByText('Đang nhận giọng nói')).not.toBeInTheDocument();
});

it('keeps support options after the greeting and hides them after the user starts chatting', () => {
  render(<App />);
  act(() => mocks.events?.message({ id: 'greeting', role: 'assistant', text: 'Chào bạn, mình đây!', final: true }));
  expect(screen.getByRole('button', { name: /^Đặt lịch hỗ trợ/ })).toBeInTheDocument();
  act(() => mocks.events?.message({ id: 'user-first', role: 'user', text: 'Kể mình nghe chuyện vui nhé.', final: true }));
  expect(screen.queryByRole('button', { name: /^Đặt lịch hỗ trợ/ })).not.toBeInTheDocument();
});

it('starts a voice session from the composer microphone', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, auth_required: false, missing: [], providers: {}, language: 'vi' }))));
  render(<App />);
  const mic = screen.getByRole('button', { name: 'Bắt đầu nói chuyện' });
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await waitFor(() => expect(mocks.connect).toHaveBeenCalledWith('', true, ''));
});

it('inserts a text attachment into a draft without sending or uploading it', async () => {
  render(<App />);
  const file = new File(['Nội dung cần hỏi'], 'ghi-chu.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: async () => 'Nội dung cần hỏi' });
  fireEvent.change(screen.getByLabelText('Chọn tệp văn bản'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue('[ghi-chu.txt]\nNội dung cần hỏi'));
  expect(mocks.sendText).not.toHaveBeenCalled();
});

it('rejects unsupported or oversized attachment drafts without losing typed text', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Nội dung tin nhắn'), { target: { value: 'Bản nháp đang viết' } });
  fireEvent.change(screen.getByLabelText('Chọn tệp văn bản'), { target: { files: [new File(['PDF'], 'ho-so.pdf')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('.txt hoặc .md');
  const file = new File(['x'.repeat(2000)], 'dai.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: async () => 'x'.repeat(2000) });
  fireEvent.change(screen.getByLabelText('Chọn tệp văn bản'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('2.000 ký tự'));
  expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue('Bản nháp đang viết');
  expect(mocks.sendText).not.toHaveBeenCalled();
});
