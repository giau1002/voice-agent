import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClientEvents } from './lib/voice-client';
import { emptyForm, type DemoFormState } from './lib/demo-form';

const mocks = vi.hoisted(() => ({ events: null as ClientEvents | null, connected: false, connect: vi.fn(), sendText: vi.fn(), formCommand: vi.fn() }));
vi.mock('./components/Portrait', () => ({ Portrait: () => <div aria-label="Nhân vật" /> }));
vi.mock('./lib/voice-client', () => ({ VoiceClient: class {
  constructor(events: ClientEvents) { mocks.events = events; }
  get connected() { return mocks.connected; }
  disconnect = vi.fn().mockResolvedValue(undefined);
  connect = vi.fn(async (access: string, mic: boolean, input: string) => {
    mocks.connect(access, mic, input); mocks.connected = true;
    mocks.events?.link('connected'); mocks.events?.agent('listening');
  });
  device = vi.fn().mockResolvedValue(undefined);
  setMicrophone = vi.fn().mockResolvedValue(undefined);
  sendText = mocks.sendText;
  formCommand = mocks.formCommand;
  microphoneEnabled() { return true; }
} }));
import App from './App';

const configured = { configured: true, auth_required: false, missing: [], providers: {}, language: 'vi' };
const uploadLabel = 'Chọn tệp PDF hoặc ảnh';
beforeEach(() => {
  mocks.events = null; mocks.connected = false; mocks.connect.mockClear(); mocks.sendText.mockReset(); mocks.formCommand.mockReset();
  mocks.sendText.mockResolvedValue(undefined);
  mocks.formCommand.mockImplementation(async (action: string, state: DemoFormState) => {
    const next = { ...state, visible: action !== 'close', active: action === 'start', confirmed: action === 'confirm', revision: state.revision + 1 };
    mocks.events?.form?.(next); return next;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...configured, configured: false, missing: ['SONIOX_API_KEY'] }))));
});

async function connect() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(configured))));
  render(<App />);
  const button = screen.getByRole('button', { name: 'Bắt đầu trò chuyện' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Kết thúc hội thoại' });
}

it('shows the avatar and procedure guide without any chat log or message input', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Trung tâm Phục vụ Hành chính công' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nhân vật')).toBeInTheDocument();
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Tờ khai đăng ký khai sinh' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' })).toBeDisabled());
  expect(screen.getByText('SONIOX_API_KEY')).toBeInTheDocument();
});

it('keeps device settings and hides local mouth controls for the GPU avatar', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...configured, avatar_mode: 'flashhead' }))));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' })).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Mở cài đặt'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Microphone')).toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: /Độ há hàm/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('offers birth registration help before receiving a form-opening event', async () => {
  await connect();
  expect(mocks.connect).toHaveBeenCalledWith('', true, '');
  fireEvent.click(screen.getByRole('button', { name: /^Đăng ký khai sinh/ }));
  await waitFor(() => expect(mocks.sendText).toHaveBeenCalledWith(expect.stringContaining('Tôi cần đăng ký giấy khai sinh')));
  const offer = 'Dạ, anh/chị có muốn em mở tờ khai đăng ký khai sinh để điền ngay không ạ?';
  act(() => mocks.events?.message({ id: 'guide', role: 'assistant', text: offer, final: true }));
  expect(screen.getByText(offer)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Tờ khai đăng ký khai sinh' })).not.toBeInTheDocument();
  expect(mocks.formCommand).not.toHaveBeenCalled();
});

it('shows partial recognized speech immediately and replaces it with the final phrase', async () => {
  await connect();
  act(() => mocks.events?.message({ id: 'speech', role: 'user', text: 'Tôi muốn', final: false }));
  expect(screen.getByText('Tôi muốn')).toBeInTheDocument();
  act(() => mocks.events?.message({ id: 'speech', role: 'user', text: 'Tôi muốn làm giấy khai sinh', final: true }));
  expect(screen.getByText('Tôi muốn làm giấy khai sinh')).toBeInTheDocument();
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
});

it('opens the form from a voice tool event and returns to guidance on a close event', async () => {
  await connect();
  const state = { ...emptyForm(), visible: true, active: true, revision: 1 };
  act(() => mocks.events?.form?.(state));
  expect(screen.getByRole('heading', { name: 'Tờ khai đăng ký khai sinh' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Trung tâm Phục vụ Hành chính công' })).not.toBeInTheDocument();
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Nhân vật')).toBeInTheDocument();
  act(() => mocks.events?.form?.({ ...state, visible: false, active: false, revision: 2 }));
  expect(screen.getByRole('heading', { name: 'Trung tâm Phục vụ Hành chính công' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Tờ khai đăng ký khai sinh' })).not.toBeInTheDocument();
});

it('supports a touch button to open and close the same voice form', async () => {
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Mở biểu mẫu' }));
  await screen.findByRole('heading', { name: 'Tờ khai đăng ký khai sinh' });
  expect(mocks.formCommand).toHaveBeenCalledWith('start', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Đóng biểu mẫu' }));
  await screen.findByRole('heading', { name: 'Trung tâm Phục vụ Hành chính công' });
  expect(mocks.formCommand).toHaveBeenCalledWith('close', expect.objectContaining({ active: true }));
});

it('uploads a PDF during voice filling, pauses the form and resumes with OCR data', async () => {
  await connect();
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: true, active: true, revision: 1 }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    text: 'Trẻ Trần Minh An, mẹ Nguyễn An', fields: { child_name: 'Trần Minh An', mother_name: 'Nguyễn An' }, warnings: ['Ảnh hơi mờ'],
  }))));
  const file = new File(['%PDF-1.4'], 'ho-so.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('textbox', { name: /^Họ tên trẻ/ })).toHaveValue('Trần Minh An'));
  expect(mocks.formCommand).toHaveBeenCalledWith('stop', expect.objectContaining({ revision: 1 }));
  expect(mocks.formCommand).toHaveBeenCalledWith('start', expect.objectContaining({ sources: { child_name: 'ocr', mother_name: 'ocr' }, fields: expect.objectContaining({ child_name: 'Trần Minh An', mother_name: 'Nguyễn An' }) }));
  expect(screen.getByText('Ảnh hơi mờ')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thay tài liệu' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Gửi tin nhắn/ })).not.toBeInTheDocument();
});

it('keeps a manual draft on OCR failure and confirms only a complete declaration', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở biểu mẫu' }));
  fireEvent.change(screen.getByRole('textbox', { name: /^Họ tên người đi đăng ký/ }), { target: { value: 'Nguyễn An' } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Chưa OCR được tệp.' }), { status: 502 })));
  fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [new File(['png'], 'mo.png')] } });
  await screen.findByText('Chưa OCR được tệp.');
  expect(screen.getByRole('textbox', { name: /^Họ tên người đi đăng ký/ })).toHaveValue('Nguyễn An');
  expect(screen.getByRole('button', { name: 'Xác nhận tờ khai' })).toBeDisabled();
  for (const [name, value] of [['Họ tên trẻ', 'Trần Minh An'], ['Nơi sinh của trẻ', 'Bệnh viện Mẫu'], ['Họ tên mẹ', 'Nguyễn An'], ['Quan hệ với trẻ', 'Mẹ'], ['Địa chỉ người đi đăng ký', '123 Đường Mẫu']]) {
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp('^' + name) }), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText(/^Ngày sinh của trẻ/), { target: { value: '2025-01-10' } });
  fireEvent.change(screen.getByRole('combobox', { name: /^Giới tính của trẻ/ }), { target: { value: 'Nam' } });
  expect(screen.getByRole('textbox', { name: /^Họ tên cha/ })).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tờ khai' }));
  expect(screen.getByRole('status')).toHaveTextContent('Chưa gửi đến cơ quan nào');
});

it('uploads and keeps OCR fields when voice pause and resume fail', async () => {
  await connect();
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: true, active: true, revision: 1 }));
  mocks.formCommand.mockRejectedValue(new Error('Request timed out'));
  const fetchUpload = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    text: 'Mẹ: Nguyễn Thu An', fields: { mother_name: 'Nguyễn Thu An' }, warnings: [],
  })));
  vi.stubGlobal('fetch', fetchUpload);
  fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [new File(['png'], 'giay-to.png')] } });
  await screen.findByRole('button', { name: 'Thay tài liệu' });
  await screen.findByText('Đã đọc và điền tài liệu. Anh/chị chọn Hỏi đáp điền form để trợ lý tiếp tục.');
  expect(fetchUpload).toHaveBeenCalledWith('/api/documents/ocr', expect.objectContaining({ method: 'POST' }));
  expect(screen.getByRole('textbox', { name: /^Họ tên mẹ/ })).toHaveValue('Nguyễn Thu An');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: true, active: true, revision: 9 }));
  expect(screen.getByRole('textbox', { name: /^Họ tên mẹ/ })).toHaveValue('Nguyễn Thu An');
});

it('starts the upload and shows extracted fields before a slow voice pause finishes', async () => {
  await connect();
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: true, active: true, revision: 1 }));
  let finishPause!: (state: DemoFormState) => void;
  mocks.formCommand.mockImplementation((action: string, state: DemoFormState) => {
    if (action === 'stop') return new Promise(resolve => { finishPause = resolve; });
    const next = { ...state, active: true, revision: state.revision + 1 };
    mocks.events?.form?.(next);
    return Promise.resolve(next);
  });
  const upload = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    text: 'Mẹ: Nguyễn Thu An', fields: { mother_name: 'Nguyễn Thu An' }, warnings: [],
  })));
  vi.stubGlobal('fetch', upload);
  fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [new File(['png'], 'giay-to.png')] } });
  await waitFor(() => expect(screen.getByRole('textbox', { name: /^Họ tên mẹ/ })).toHaveValue('Nguyễn Thu An'));
  expect(upload).toHaveBeenCalled();
  act(() => {
    const stopped = { ...emptyForm(), visible: true, revision: 2 };
    mocks.events?.form?.(stopped); finishPause(stopped);
  });
  await waitFor(() => expect(mocks.formCommand).toHaveBeenCalledWith('start', expect.objectContaining({ revision: 2 })));
  expect(screen.getByRole('textbox', { name: /^Họ tên mẹ/ })).toHaveValue('Nguyễn Thu An');
});

it('shows a useful upload error for a non-JSON server response', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở biểu mẫu' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
  fireEvent.change(screen.getByLabelText(uploadLabel), { target: { files: [new File(['png'], 'giay-to.png')] } });
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Máy chủ chưa đọc được tệp');
});

it('ignores stale form packets so a closed form is not reopened', async () => {
  await connect();
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: false, revision: 3 }));
  act(() => mocks.events?.form?.({ ...emptyForm(), visible: true, active: true, revision: 2 }));
  expect(screen.queryByRole('heading', { name: 'Tờ khai đăng ký khai sinh' })).not.toBeInTheDocument();
});

it('passes an existing draft to the worker after connecting from the form', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(configured))));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Mở biểu mẫu' }));
  fireEvent.change(screen.getByRole('textbox', { name: /^Họ tên người đi đăng ký/ }), { target: { value: 'Nguyễn An' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kết nối trợ lý' }));
  await waitFor(() => expect(mocks.formCommand).toHaveBeenCalledWith('start', expect.objectContaining({ fields: expect.objectContaining({ full_name: 'Nguyễn An' }) })));
  expect(screen.getByRole('textbox', { name: /^Họ tên người đi đăng ký/ })).toHaveValue('Nguyễn An');
});
