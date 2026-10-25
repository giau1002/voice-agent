import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, CircleHelp, LoaderCircle, Mic, MicOff, Phone, PhoneOff, Settings2, Square, Volume2, X } from 'lucide-react';
import { Portrait, type PortraitOptions } from './components/Portrait';
import { DemoForm } from './components/DemoForm';
import { ProcedureGuide } from './components/ProcedureGuide';
import { emptyForm, formProblem, type DemoFormState, type FormKey } from './lib/demo-form';
import { VoiceClient, type AgentState, type LinkState } from './lib/voice-client';
import { LipSync } from './lib/lip-sync';
import type { WebLookup } from './lib/web-search';
import type { RemoteTrack } from 'livekit-client';

interface Config {
  auth_required: boolean; configured: boolean; missing: string[]; language: string;
  providers: { transport: string; stt: string; tts: string; llm: string; vad: string };
  avatar_mode?: 'photo' | 'flashhead';
}
const stateLabels: Record<AgentState, string> = { idle: 'Sẵn sàng trò chuyện', initializing: 'Đang gọi trợ lý', listening: 'Em đang lắng nghe', thinking: 'Đang chuẩn bị hướng dẫn', speaking: 'Trợ lý đang nói' };

export default function App() {
  const [link, setLink] = useState<LinkState>('offline');
  const [agent, setAgent] = useState<AgentState>('idle');
  const [config, setConfig] = useState<Config | null>(null);
  const [answer, setAnswer] = useState('');
  const [heard, setHeard] = useState('');
  const [topic, setTopic] = useState('');
  const [lookup, setLookup] = useState<WebLookup | null>(null);
  const [error, setError] = useState('');
  const [access, setAccess] = useState('');
  const [settings, showSettings] = useState(false);
  const [mic, setMic] = useState(true);
  const [playback, setPlayback] = useState(true);
  const [sending, setSending] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const formSnapshot = useRef(form);
  formSnapshot.current = form;
  const [formBusy, setFormBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [documentName, setDocumentName] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrWarnings, setOcrWarnings] = useState<string[]>([]);
  const attachment = useRef<HTMLInputElement>(null);
  const ocrAbort = useRef<AbortController | null>(null);
  const resumeFormOnReady = useRef(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [options, setOptions] = useState<PortraitOptions>({
    motion: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    mode: 'photo', intensity: 1, jaw: 1.5, delay: 60,
  });
  const [lips] = useState(() => new LipSync());
  const [avatarVideo, setAvatarVideo] = useState<RemoteTrack | null>(null);
  const [client] = useState(() => new VoiceClient({
    link: setLink, agent: setAgent,
    message: message => {
      if (message.lookup) setLookup(message.lookup);
      else if (message.role === 'assistant') setAnswer(message.text.slice(0, 6000));
      else { setHeard(message.text); if (message.final) setLookup(null); }
    },
    text: (chunk, final) => lips.pushText(chunk, performance.now(), final),
    interrupt: () => lips.clear(), error: setError, playback: setPlayback, quality: () => {},
    ended: () => {
      lips.clear(); setPlayback(true);
      setForm(current => ({ ...current, active: false, revision: 0 }));
    },
    video: setAvatarVideo,
    form: state => {
      if (state.revision < formSnapshot.current.revision) return;
      formSnapshot.current = state; setForm(state); setFormOpen(state.visible);
    },
  }));

  function saveDraft(state: DemoFormState) { formSnapshot.current = state; setForm(state); }
  async function refreshConfig() {
    try { const response = await fetch('/api/config'); if (!response.ok) throw Error(); setConfig(await response.json()); }
    catch { setError('Không kết nối được API. Kiểm tra server ở cổng 8790.'); }
  }
  useEffect(() => {
    void refreshConfig();
    const hide = () => { void client.disconnect(); };
    window.addEventListener('pagehide', hide);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = (event: MediaQueryListEvent) => { if (event.matches) setOptions(old => ({ ...old, motion: false })); };
    media?.addEventListener('change', reduced);
    return () => { ocrAbort.current?.abort(); window.removeEventListener('pagehide', hide); media?.removeEventListener('change', reduced); void client.disconnect(); };
  }, [client]);
  useEffect(() => {
    const enumerate = async () => { try { setDevices(await navigator.mediaDevices?.enumerateDevices() || []); } catch { /* Device names may require permission. */ } };
    void enumerate(); navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
  }, [link, settings]);

  const online = link === 'connected';
  const busy = link === 'connecting' || link === 'reconnecting';
  const title = busy ? 'Đang kết nối trợ lý' : online ? stateLabels[agent] : 'Bắt đầu để được hướng dẫn';
  useEffect(() => {
    if (!resumeFormOnReady.current || !online || !['listening', 'speaking', 'idle'].includes(agent)) return;
    resumeFormOnReady.current = false;
    setFormBusy(true);
    void client.formCommand('start', formSnapshot.current)
      .catch(() => setError('Chưa tiếp tục được phiếu. Anh/chị chọn Hỏi đáp điền form để thử lại nhé.'))
      .finally(() => setFormBusy(false));
  }, [online, agent, client]);
  async function connect() {
    if (link !== 'offline') { await client.disconnect(); return; }
    setError('');
    if (config?.auth_required && !access) { showSettings(true); setError('Nhập mã truy cập để bắt đầu phiên.'); return; }
    resumeFormOnReady.current = formSnapshot.current.visible;
    setHeard('');
    await client.connect(access, true, input);
    if (!client.connected) resumeFormOnReady.current = false;
    setMic(client.microphoneEnabled());
    if (output) try { await client.device('audiooutput', output); } catch { setError('Trình duyệt chưa hỗ trợ đổi loa.'); }
  }
  async function toggleMic() {
    try { await client.setMicrophone(!mic); setMic(!mic); }
    catch { setError('Không mở được micro. Kiểm tra quyền truy cập hoặc chọn thiết bị khác.'); }
  }
  async function chooseTopic(value: string) {
    if (!online || sending) return;
    setTopic(value); setLookup(null); setError(''); setSending(true);
    try { await client.sendText('Tôi muốn được hướng dẫn về ' + value + '. Hãy hướng dẫn trước, chưa mở biểu mẫu.'); }
    catch (exception) { setError(exception instanceof Error ? exception.message : 'Chưa gửi được yêu cầu hướng dẫn.'); }
    finally { setSending(false); }
  }
  async function controlForm(action: 'start' | 'stop' | 'confirm' | 'close') {
    if (formBusy || ocrBusy) return;
    if (action === 'confirm' && formProblem(form.fields)) { setError(formProblem(form.fields)); return; }
    if (!online) {
      const state = { ...form, visible: action !== 'close', active: false, confirmed: action === 'confirm' };
      saveDraft(state); setFormOpen(state.visible); return;
    }
    setFormBusy(true); setError('');
    try { await client.formCommand(action, form); }
    catch (exception) { setError(exception instanceof Error ? exception.message : 'Chưa cập nhật được biểu mẫu.'); }
    finally { setFormBusy(false); }
  }
  function changeFormField(key: FormKey, value: string) {
    saveDraft({ ...form, confirmed: false, fields: { ...form.fields, [key]: value }, sources: { ...form.sources, [key]: 'user' } });
  }
  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || ocrBusy || formBusy) return;
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { setError('Chọn PDF hoặc ảnh JPG, PNG, WebP.'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('Tệp cần nhỏ hơn hoặc bằng 8 MB.'); return; }
    const controller = new AbortController(); ocrAbort.current = controller;
    setFormOpen(true); setOcrBusy(true); setError('');
    let draft = formSnapshot.current;
    try {
      if (draft.active && client.connected) draft = await client.formCommand('stop', draft);
      const extension = file.name.split('.').pop()!.toLowerCase();
      const mime = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[extension]!;
      const response = await fetch('/api/documents/ocr', {
        method: 'POST', body: file, headers: { 'Content-Type': mime, ...(access ? { Authorization: 'Bearer ' + access } : {}) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]),
      });
      const result = await response.json();
      if (!response.ok) throw Error(typeof result.detail === 'string' ? result.detail : 'Chưa OCR được tài liệu.');
      if (controller.signal.aborted) return;
      setDocumentName(file.name); setOcrText(result.text); setOcrWarnings(result.warnings);
      const fields = { ...draft.fields }, sources = { ...draft.sources };
      for (const key of Object.keys(fields) as FormKey[]) {
        if (result.fields[key] && (!fields[key] || sources[key] === 'ocr')) { fields[key] = result.fields[key]; sources[key] = 'ocr'; }
      }
      const updated = { ...draft, visible: true, fields, sources, active: false, confirmed: false };
      saveDraft(updated);
      if (client.connected) await client.formCommand('start', updated);
    } catch (exception) {
      if (!controller.signal.aborted) setError(exception instanceof DOMException && exception.name === 'TimeoutError'
        ? 'OCR đang mất nhiều thời gian. Anh/chị thử lại với tệp nhỏ hơn nhé.'
        : exception instanceof Error ? exception.message : 'Chưa đọc được tài liệu.');
    } finally { if (ocrAbort.current === controller) { setOcrBusy(false); ocrAbort.current = null; } }
  }
  function changeOption<K extends keyof PortraitOptions>(key: K, value: PortraitOptions[K]) { setOptions(current => ({ ...current, [key]: value })); }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Trang chủ Trung tâm Phục vụ hành chính công"><img className="brand-mark" src="/brand/public-service.svg" alt="" /><span className="brand-copy"><strong>TRUNG TÂM PHỤC VỤ HÀNH CHÍNH CÔNG</strong><span>Hệ thống Kiosk Hành chính công thông minh</span></span></a>
      <button className="icon-button" onClick={() => showSettings(true)} aria-label="Mở cài đặt"><Settings2 size={20} /></button>
    </header>
    <main className="app-main">
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Đóng thông báo"><X size={16} /></button></div>}
      {config && !config.configured && <div className="notice setup-notice"><Settings2 size={18} /><span>Chưa sẵn sàng kết nối: cần điền <strong>{config.missing.join(', ')}</strong> trong file .env của server.</span><button onClick={() => void refreshConfig()}>Kiểm tra lại</button></div>}
      <section className="kiosk-workspace" aria-label="Hỗ trợ hành chính công">
        <section className="assistant-panel" aria-label="Trợ lý giọng nói" key="assistant">
          <div className="portrait-panel"><div className="portrait-stage"><Portrait client={client} lips={lips} options={options} videoTrack={avatarVideo} /></div></div>
          <div className="voice-console">
            <div className="voice-state"><span className={'small-dot ' + (online ? 'active' : '')} /><strong>{title}</strong></div>
            {formOpen && answer && <p className="voice-caption">{answer}</p>}
            {heard && <p className="last-heard" role="status" aria-label="Lời nói đã nhận" aria-live="polite"><Mic size={15} aria-hidden="true" /><span><strong>Anh/chị vừa nói:</strong> {heard}</span></p>}
            <div className="voice-controls">
              <button className={'voice-connect ' + (online ? 'online' : '')} onClick={() => void connect()} disabled={!busy && !online && !config?.configured} aria-label={online ? 'Kết thúc hội thoại' : busy ? 'Hủy kết nối' : 'Bắt đầu trò chuyện'}>
                {busy ? <LoaderCircle size={18} className="spin" /> : online ? <PhoneOff size={18} /> : <Phone size={18} />}
                {online ? 'Kết thúc' : busy ? 'Đang kết nối…' : 'Bắt đầu trò chuyện'}
              </button>
              {online && <><button className="voice-mic" onClick={() => void toggleMic()} aria-label={mic ? 'Tắt microphone' : 'Bật microphone'} aria-pressed={mic}>{mic ? <Mic size={20} /> : <MicOff size={20} />}</button><button className="voice-interrupt" disabled={agent !== 'speaking'} onClick={() => void client.interrupt().catch(() => setError('Chưa ngắt được lời. Anh/chị thử nói qua micro.'))}><Square size={13} /> Ngắt lời</button></>}
            </div>
            <p className="voice-help">{online ? mic ? 'Anh/chị nói trực tiếp để được hỗ trợ.' : 'Micro đang tắt. Bật micro để tiếp tục trò chuyện.' : 'Cho phép micro khi trình duyệt hỏi quyền truy cập.'}</p>
            {!playback && online && <button className="playback-button" onClick={() => void client.playAudio().catch(() => setError('Chưa phát được âm thanh.'))}><Volume2 size={16} /> Bấm để nghe hướng dẫn</button>}
          </div>
        </section>
        {formOpen ? <DemoForm key="form" state={form} online={online} connecting={busy} connectionDisabled={!config?.configured} busy={formBusy} ocrBusy={ocrBusy} filename={documentName} ocrText={ocrText} warnings={ocrWarnings}
          onChange={changeFormField} onUpload={() => attachment.current?.click()} onStart={() => void controlForm('start')} onStop={() => void controlForm('stop')} onConnect={() => void connect()} onConfirm={() => void controlForm('confirm')} onClose={() => void controlForm('close')} />
          : <ProcedureGuide key="guide" answer={answer} topic={topic} lookup={lookup} connected={online} disabled={!online || busy || sending || agent === 'initializing'} onTopic={value => void chooseTopic(value)} onOpenForm={() => void controlForm('start')} />}
      </section>
      <input ref={attachment} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" tabIndex={-1} aria-label="Chọn tệp PDF hoặc ảnh" onChange={event => void uploadDocument(event)} />
    </main>
    {settings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) showSettings(false); }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-title"><div><div className="eyebrow">CÁ NHÂN HÓA TRẢI NGHIỆM</div><h2 id="settings-title">Thiết bị & chuyển động</h2></div><button className="icon-button" onClick={() => showSettings(false)} aria-label="Đóng cài đặt"><X size={20} /></button></div>
      <label className="field">Mã truy cập ứng dụng<input type="password" value={access} onChange={event => setAccess(event.target.value)} placeholder={config?.auth_required ? 'Nhập mã do quản trị viên cung cấp' : 'Không bắt buộc trên localhost'} autoComplete="off" /></label><p className="field-note">Mã chỉ giữ trong bộ nhớ tab; khóa dịch vụ được cấu hình trên server.</p>
      <label className="field">Microphone<select value={input} onChange={event => { const id = event.target.value; setInput(id); void client.device('audioinput', id).catch(() => setError('Không đổi được microphone.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audioinput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></label>
      <label className="field">Loa / tai nghe<select value={output} onChange={event => { const id = event.target.value; setOutput(id); void client.device('audiooutput', id).catch(() => setError('Trình duyệt chưa hỗ trợ đổi loa.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audiooutput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Loa ${i + 1}`}</option>)}</select></label>
      {config?.avatar_mode !== 'flashhead' && <><div className="setting-switch"><div><strong>Cử động đầu khi nói</strong><p>Nghiêng nhẹ, có khoảng nghỉ giữa các nhịp</p></div><input type="checkbox" checked={options.motion} onChange={event => changeOption('motion', event.target.checked)} aria-label="Cử động đầu khi nói" /></div>
      <label className="range-field"><span>Mức cử động đầu <output>{Math.round(options.intensity * 100)}%</output></span><input aria-label="Mức cử động đầu" type="range" min="0.5" max="1.4" step="0.1" value={options.intensity} onChange={event => changeOption('intensity', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ há hàm <output>{Math.round(options.jaw * 100)}%</output></span><input aria-label="Độ há hàm" type="range" min="0.6" max="1.8" step="0.05" value={options.jaw} onChange={event => changeOption('jaw', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ trễ môi <output>{options.delay} ms</output></span><input aria-label="Độ trễ môi" type="range" min="0" max="200" step="10" value={options.delay} onChange={event => changeOption('delay', Number(event.target.value))} /></label><p className="field-note">Miệng đi trước tiếng: tăng độ trễ. Khẩu hình trong từ vẫn là ước lượng, được điều tiết theo âm thanh đang phát.</p>
      </>}
      <button className="save-settings" onClick={() => showSettings(false)}><Check size={17} /> Xong</button>
    </section></div>}
  </div>;
}
