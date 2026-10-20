import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleHelp, FileText, LoaderCircle, MessageCircle, Mic, MicOff, Phone, PhoneOff, Search, Send, Settings2, Square, Volume2, X } from 'lucide-react';
import { Portrait, type PortraitOptions } from './components/Portrait';
import { DrumPattern, ServiceMark } from './components/KioskBrand';
import { searchProcedures, type Procedure } from './data/procedures';
import { VoiceClient, type AgentState, type LinkState, type Message } from './lib/voice-client';
import { LipSync } from './lib/lip-sync';

interface Config {
  auth_required: boolean; configured: boolean; missing: string[]; language: string;
  providers: { transport: string; stt: string; tts: string; llm: string; vad: string };
}
const stateLabels: Record<AgentState, string> = { idle: 'Sẵn sàng trò chuyện', initializing: 'Đang gọi trợ lý', listening: 'Tôi đang lắng nghe', thinking: 'Đang nghĩ câu trả lời', speaking: 'Trợ lý đang nói' };

export default function App() {
  const [link, setLink] = useState<LinkState>('offline');
  const [agent, setAgent] = useState<AgentState>('idle');
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [access, setAccess] = useState('');
  const [settings, showSettings] = useState(false);
  const [mic, setMic] = useState(true);
  const [level, setLevel] = useState(0);
  const [playback, setPlayback] = useState(true);
  const [, setQuality] = useState('');
  const [tab, setTab] = useState<'popular' | 'search' | 'forms'>('popular');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Procedure | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [options, setOptions] = useState<PortraitOptions>({
    motion: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    intensity: 1, jaw: 1.2, delay: 60,
  });
  const transcript = useRef<HTMLDivElement>(null);
  const [lips] = useState(() => new LipSync());
  const [client] = useState(() => new VoiceClient({
    link: setLink, agent: setAgent,
    message: message => setMessages(current => {
      const index = current.findIndex(item => item.id === message.id);
      if (index < 0) return [...current.slice(-199), message];
      return current.map(item => item.id === message.id ? message : item);
    }),
    text: (chunk, final) => lips.pushText(chunk, performance.now(), final),
    interrupt: () => lips.clear(), error: setError, playback: setPlayback, quality: setQuality,
    ended: () => { lips.clear(); setLevel(0); setPlayback(true); },
  }));

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
    return () => { window.removeEventListener('pagehide', hide); media?.removeEventListener('change', reduced); void client.disconnect(); };
  }, [client]);
  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const enumerate = async () => { try { setDevices(await navigator.mediaDevices?.enumerateDevices() || []); } catch { /* Device list is optional before permissions. */ } };
    void enumerate(); navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
  }, [link, settings]);

  const online = link === 'connected';
  const busy = link === 'connecting' || link === 'reconnecting';
  const title = link === 'connecting' ? 'Đang kết nối' : link === 'reconnecting' ? 'Đang nối lại' : stateLabels[agent];
  async function connect() {
    if (link !== 'offline') { await client.disconnect(); return; }
    setError('');
    if (config?.auth_required && !access) { showSettings(true); setError('Nhập mã truy cập để bắt đầu phiên.'); return; }
    await client.connect(access, mic, input);
    setMic(client.microphoneEnabled());
    if (output) try { await client.device('audiooutput', output); } catch { setError('Trình duyệt chưa hỗ trợ đổi loa.'); }
  }
  async function send(value = text) {
    if (!value.trim() || sending) return;
    setError(''); setSending(true);
    try { await client.sendText(value); setText(''); }
    catch (exception) { setError(exception instanceof Error ? exception.message : 'Chưa gửi được tin nhắn.'); }
    finally { setSending(false); }
  }
  async function toggleMic() {
    const next = !mic;
    try { if (online) await client.setMicrophone(next); setMic(next); }
    catch { setError('Không mở được micro. Kiểm tra quyền truy cập hoặc chọn thiết bị khác.'); }
  }
  function changeOption<K extends keyof PortraitOptions>(key: K, value: PortraitOptions[K]) { setOptions(current => ({ ...current, [key]: value })); }
  function chooseProcedure(procedure: Procedure) {
    setSelected(procedure); setChatOpen(true);
    const question = tab === 'forms'
      ? `Tôi muốn tìm hiểu mẫu đơn dùng cho thủ tục: ${procedure.title}. Hãy giúp tôi xác định mẫu cần dùng.`
      : `Tôi muốn tìm hiểu thủ tục: ${procedure.title}. Bạn có thể hỗ trợ tôi không?`;
    if (online) void send(question);
    else { setText(question); setTimeout(() => composer.current?.focus(), 0); }
  }
  const visibleProcedures = searchProcedures(tab === 'search' ? query : '');

  return <div className="kiosk-shell">
    <header className="kiosk-banner">
      <div className="banner-seal"><ServiceMark /></div>
      <div className="banner-copy"><h1>TRUNG TÂM PHỤC VỤ HÀNH CHÍNH CÔNG</h1><p>TRỢ LÝ HƯỚNG DẪN THỦ TỤC HÀNH CHÍNH</p></div>
      <button className="icon-button banner-settings" onClick={() => showSettings(true)} aria-label="Mở cài đặt"><Settings2 size={20} /></button>
    </header>
    <main className="kiosk-content">
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Đóng thông báo"><X size={16} /></button></div>}
      {config && !config.configured && <div className="notice setup-notice"><Settings2 size={18} /><span>Chưa sẵn sàng kết nối: cần điền <strong>{config.missing.join(', ')}</strong> trong file .env của server.</span><button onClick={() => void refreshConfig()}>Kiểm tra lại</button></div>}
      <section className="kiosk-display" aria-label="Trợ lý và thủ tục hành chính">
        <DrumPattern />
        <div className="kiosk-character">
          <Portrait client={client} lips={lips} options={options} onLevel={setLevel} />
          <div className="character-status"><span className={`small-dot ${online ? 'active' : ''}`} /><span>{online || busy ? title : 'Xin chào! Tôi có thể giúp gì cho bạn?'}</span><div className="audio-wave" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ height: 3 + level * (12 + (i % 5) * 6) }} />)}</div></div>
        </div>
        <aside className="procedure-panel" aria-label="Tra cứu thủ tục">
          <div className="procedure-tabs" role="tablist" aria-label="Danh mục tra cứu">{([
            ['popular', 'Thủ tục phổ biến'], ['search', 'Tìm kiếm'], ['forms', 'Mẫu đơn'],
          ] as const).map(([key, label]) => <button key={key} role="tab" id={`tab-${key}`} aria-controls="procedure-results" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => { setTab(key); if (key === 'search') setTimeout(() => searchInput.current?.focus(), 0); }} onKeyDown={event => {
            const tabs = ['popular', 'search', 'forms'] as const;
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(key) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
              setTab(tabs[next]); document.getElementById(`tab-${tabs[next]}`)?.focus();
            }
          }}>{key === 'search' && <Search size={14} />}{key === 'forms' && <FileText size={14} />}<span>{label}</span></button>)}</div>
          {tab === 'search' && <div className="procedure-search"><Search size={17} /><input ref={searchInput} aria-label="Tìm thủ tục" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tên hoặc mã thủ tục…" />{query && <button aria-label="Xóa tìm kiếm" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={15} /></button>}</div>}
          {tab === 'forms' && <p className="forms-note">Chọn thủ tục để hỏi trợ lý về mẫu đơn cần dùng.</p>}
          <div className="procedure-list" role="tabpanel" id="procedure-results" aria-labelledby={`tab-${tab}`}>
            {visibleProcedures.map((procedure, index) => <button className={`procedure-card ${selected?.id === procedure.id ? 'selected' : ''}`} key={procedure.id} aria-pressed={selected?.id === procedure.id} onClick={() => chooseProcedure(procedure)} disabled={sending}>
              <span className="procedure-number">{String(index + 1).padStart(2, '0')}</span><div className="procedure-detail"><span className="procedure-code">{procedure.id} <span>• {procedure.category}</span></span><h2>{procedure.title}</h2>{tab === 'forms' && <span className="form-link"><FileText size={12} /> Hỏi về mẫu đơn</span>}</div>{procedure.popular && tab === 'popular' ? <span className="popular-pill">Hay<br />được hỏi</span> : <ChevronRight className="procedure-arrow" size={16} />}
            </button>)}
            {visibleProcedures.length === 0 && <div className="search-empty"><Search size={28} /><h2>Chưa tìm thấy thủ tục</h2><p>Thử từ khóa khác hoặc hỏi trực tiếp trợ lý.</p><button onClick={() => { setChatOpen(true); setText(`Tôi muốn tìm hiểu về ${query}.`); setTimeout(() => composer.current?.focus(), 0); }}>Hỏi trợ lý <ChevronRight size={14} /></button></div>}
          </div>
          <p className="procedure-hint"><Mic size={14} /><span>Chạm vào thủ tục hoặc nói để được hỗ trợ</span></p>
        </aside>
      </section>
      <section className="kiosk-conversation" aria-label="Hội thoại với trợ lý">
        <div className="conversation-bar"><button aria-expanded={chatOpen} aria-controls="conversation-body" onClick={() => setChatOpen(value => !value)}><MessageCircle size={16} /><span>NỘI DUNG TRÒ CHUYỆN</span><ChevronRight size={16} className={chatOpen ? 'expanded' : ''} /></button><span className={`session-state ${online ? 'online' : ''}`}><span className="small-dot" />{online ? title : busy ? 'ĐANG KẾT NỐI' : 'CHƯA KẾT NỐI'}</span></div>
        <div className="conversation-body" id="conversation-body" hidden={!chatOpen}>
          {selected && <div className="selected-topic"><FileText size={14} /><span>Đang tìm hiểu: <strong>{selected.title}</strong></span><button aria-label="Bỏ chọn thủ tục" onClick={() => setSelected(null)}><X size={14} /></button></div>}
          <div className="messages" ref={transcript} role="log" aria-label="Nội dung hội thoại">{messages.length === 0 ? <div className="welcome-message"><span className="welcome-icon"><MessageCircle size={21} /></span><div><h2>Xin chào, tôi là trợ lý của bạn.</h2><p>Chọn một thủ tục, bật micro hoặc nhập câu hỏi để bắt đầu.</p></div></div> : messages.map(message => <article className={`message ${message.role}`} key={message.id}><span className="message-label">{message.role === 'assistant' ? 'TRỢ LÝ' : 'BẠN'}</span><p>{message.text}{!message.final && <span className="typing-cursor" />}</p></article>)}{agent === 'thinking' && <div className="thinking"><i /><i /><i /><span>Trợ lý đang suy nghĩ</span></div>}</div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="chat-input">Nội dung tin nhắn</label><textarea ref={composer} id="chat-input" value={text} onChange={event => setText(event.target.value)} placeholder="Nhập điều bạn muốn hỏi…" maxLength={2000} rows={1} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button type="submit" disabled={!online || !text.trim() || sending} aria-label="Gửi tin nhắn">{sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>
        </div>
      </section>
      <div className="kiosk-actions">
        <button className={`connect-button ${online ? 'connected' : ''}`} onClick={() => void connect()} disabled={!!config && !config.configured && link === 'offline'}>{busy ? <LoaderCircle size={18} className="spin" /> : online ? <PhoneOff size={18} /> : <Phone size={18} />}<span>{online ? 'Kết thúc hội thoại' : busy ? 'Hủy kết nối' : 'Bắt đầu trò chuyện'}</span></button>
        <button className={`mic-button ${mic ? '' : 'muted'}`} onClick={() => void toggleMic()} aria-label={mic ? 'Tắt microphone' : 'Bật microphone'} aria-pressed={mic}>{mic ? <Mic size={19} /> : <MicOff size={19} />}</button>
        {online && <button className="interrupt-button" disabled={agent !== 'speaking'} onClick={() => void client.interrupt().catch(() => setError('Chưa ngắt được lời. Thử nói qua micro.'))}><Square size={13} /> Ngắt lời</button>}
        {!playback && online && <button className="playback-button" onClick={() => void client.playAudio().catch(() => setError('Chưa phát được âm thanh. Kiểm tra quyền phát tiếng.'))}><Volume2 size={16} /> Bật âm thanh</button>}
        <button className="device-button" onClick={() => showSettings(true)}><Settings2 size={16} /><span>Thiết bị & chuyển động</span></button>
      </div>
    </main>
    <footer className="kiosk-footer"><span>TẬN TÂM PHỤC VỤ <i>•</i> ĐỒNG HÀNH CÙNG BẠN</span><span>Trợ lý AI hỗ trợ tra cứu</span></footer>
    {settings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) showSettings(false); }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-title"><div><div className="eyebrow">CÁ NHÂN HÓA TRẢI NGHIỆM</div><h2 id="settings-title">Thiết bị & chuyển động</h2></div><button className="icon-button" onClick={() => showSettings(false)} aria-label="Đóng cài đặt"><X size={20} /></button></div>
      <label className="field">Mã truy cập ứng dụng<input type="password" value={access} onChange={event => setAccess(event.target.value)} placeholder={config?.auth_required ? 'Nhập mã do quản trị viên cung cấp' : 'Không bắt buộc trên localhost'} autoComplete="off" /></label><p className="field-note">Mã chỉ giữ trong bộ nhớ tab; khóa dịch vụ được cấu hình trên server.</p>
      <label className="field">Microphone<select value={input} onChange={event => { const id = event.target.value; setInput(id); void client.device('audioinput', id).catch(() => setError('Không đổi được microphone.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audioinput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></label>
      <label className="field">Loa / tai nghe<select value={output} onChange={event => { const id = event.target.value; setOutput(id); void client.device('audiooutput', id).catch(() => setError('Trình duyệt chưa hỗ trợ đổi loa.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audiooutput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Loa ${i + 1}`}</option>)}</select></label>
      <div className="setting-switch"><div><strong>Cử động đầu khi nói</strong><p>Nghiêng nhẹ, có khoảng nghỉ giữa các nhịp</p></div><input type="checkbox" checked={options.motion} onChange={event => changeOption('motion', event.target.checked)} aria-label="Cử động đầu khi nói" /></div>
      <label className="range-field"><span>Mức cử động đầu <output>{Math.round(options.intensity * 100)}%</output></span><input type="range" min="0.5" max="1.4" step="0.1" value={options.intensity} onChange={event => changeOption('intensity', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ há hàm <output>{Math.round(options.jaw * 100)}%</output></span><input type="range" min="0.6" max="1.2" step="0.05" value={options.jaw} onChange={event => changeOption('jaw', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ trễ môi <output>{options.delay} ms</output></span><input type="range" min="0" max="200" step="10" value={options.delay} onChange={event => changeOption('delay', Number(event.target.value))} /></label><p className="field-note">Miệng đi trước tiếng: tăng độ trễ. Khẩu hình trong từ vẫn là ước lượng, được điều tiết theo âm thanh đang phát.</p>
      <button className="save-settings" onClick={() => showSettings(false)}><Check size={17} /> Xong</button>
    </section></div>}
  </div>;
}
