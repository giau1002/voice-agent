import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Check, CircleHelp, Headphones, LoaderCircle, MessageCircle, Mic, MicOff, Phone, PhoneOff, Send, Settings2, Sparkles, Square, Volume2, X } from 'lucide-react';
import { Portrait, type PortraitOptions } from './components/Portrait';
import { SearchReference } from './components/SearchReference';
import { VoiceClient, type AgentState, type LinkState, type Message } from './lib/voice-client';
import { LipSync } from './lib/lip-sync';

interface Config {
  auth_required: boolean; configured: boolean; missing: string[]; language: string;
  providers: { transport: string; stt: string; tts: string; llm: string; vad: string };
}
const stateLabels: Record<AgentState, string> = { idle: 'Sẵn sàng trò chuyện', initializing: 'Đang gọi trợ lý', listening: 'Tôi đang lắng nghe', thinking: 'Đang nghĩ câu trả lời', speaking: 'Trợ lý đang nói' };
const suggestions = ['Nói chuyện với mình một chút nhé.', 'Kể mình nghe một chuyện vui đi.', 'Cùng nghĩ một ý tưởng thú vị nhé.'];

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
  const [playback, setPlayback] = useState(true);
  const [, setQuality] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
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
    ended: () => { lips.clear(); setPlayback(true); },
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
  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'instant' }); }, [messages]);
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
  function useSuggestion(value: string) {
    if (online) void send(value);
    else { setText(value); composer.current?.focus(); }
  }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Trang chủ Trung tâm Phục vụ hành chính công đặc khu Cô Tô"><img className="brand-mark" src="/brand/public-service.svg" alt="" /><span className="brand-copy"><strong>TRUNG TÂM PHỤC VỤ HÀNH CHÍNH CÔNG ĐẶC KHU CÔ TÔ</strong><span>Hệ thống Kiosk Hành chính công thông minh</span></span></a>
      <div className="header-actions"><button className="icon-button" onClick={() => showSettings(true)} aria-label="Mở cài đặt"><Settings2 size={20} /></button></div>
    </header>
    <main className="app-main">
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Đóng thông báo"><X size={16} /></button></div>}
      {config && !config.configured && <div className="notice setup-notice"><Settings2 size={18} /><span>Chưa sẵn sàng kết nối: cần điền <strong>{config.missing.join(', ')}</strong> trong file .env của server.</span><button onClick={() => void refreshConfig()}>Kiểm tra lại</button></div>}
      <section className="conversation-workspace" aria-label="Trò chuyện với bạn đồng hành">
        <div className="portrait-panel">
          <Portrait client={client} lips={lips} options={options} />
        </div>
        <aside className="chat-panel" aria-labelledby="chat-title">
          <div className="chat-header"><div className="chat-heading"><span className="assistant-icon"><Headphones size={23} strokeWidth={1.65} /></span><div><h2 id="chat-title">Trò chuyện cùng trợ lý</h2><p><span className={`small-dot ${online ? 'active' : ''}`} />{online || busy ? title : 'Sẵn sàng khi bạn cần'}</p></div></div><span className={`connection-badge ${online ? 'online' : ''}`}>{online ? 'Đã kết nối' : busy ? 'Đang kết nối' : 'Chưa kết nối'}</span></div>
          <div className="messages" ref={transcript} role="log" aria-label="Nội dung hội thoại">
            {messages.length === 0 ? <div className="chat-welcome"><div className="welcome-illustration"><span className="welcome-ring" /><MessageCircle size={39} strokeWidth={1.5} /><span className="welcome-spark"><Sparkles size={16} /></span></div><span className="welcome-kicker">RẤT VUI ĐƯỢC GẶP BẠN</span><h3>Hôm nay bạn thế nào?</h3><p>Có chuyện muốn kể, câu hỏi muốn hỏi,<br />hay chỉ muốn trò chuyện một chút? Mình nghe đây.</p><div className="suggestions"><span>BẠN CÓ THỂ HỎI</span>{suggestions.map(value => <button key={value} disabled={sending} onClick={() => useSuggestion(value)}>{value}<ArrowUpRight size={15} /></button>)}</div></div> : <><div className="transcript-divider"><span>Nội dung cuộc trò chuyện</span></div>{messages.map(message => message.lookup ? <SearchReference key={message.id} lookup={message.lookup} /> : <article className={`message ${message.role}`} key={message.id}><span className="message-avatar" aria-hidden="true">{message.role === 'assistant' ? <Sparkles size={15} /> : 'B'}</span><div className="message-content"><span className="message-label">{message.role === 'assistant' ? 'Trợ lý' : 'Bạn'}{!message.final && message.role === 'user' && <span className="transcribing"> · Đang nhận giọng nói</span>}</span><p>{message.text}{!message.final && message.role === 'assistant' && <span className="typing-cursor" />}</p></div></article>)}</>}
            {agent === 'thinking' && <div className="thinking"><i /><i /><i /><span>Trợ lý đang suy nghĩ…</span></div>}
          </div>
          <div className="chat-input-area">
            {!playback && online && <button className="playback-button" onClick={() => void client.playAudio().catch(() => setError('Chưa phát được âm thanh. Kiểm tra quyền phát tiếng.'))}><Volume2 size={16} /> Bấm để nghe câu trả lời</button>}
            <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="chat-input">Nội dung tin nhắn</label><textarea ref={composer} id="chat-input" value={text} onChange={event => setText(event.target.value)} placeholder="Kể mình nghe hoặc hỏi điều gì đó…" maxLength={2000} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><div className="composer-bottom"><span><MessageCircle size={13} />{online ? 'Enter để gửi tin nhắn' : 'Kết nối để gửi tin nhắn'}</span><button type="submit" disabled={!online || !text.trim() || sending} aria-label="Gửi tin nhắn">{sending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}</button></div></form>
            <div className="call-controls"><button className={`connect-button ${online ? 'connected' : ''}`} onClick={() => void connect()} disabled={!!config && !config.configured && link === 'offline'}>{busy ? <LoaderCircle size={18} className="spin" /> : online ? <PhoneOff size={18} /> : <Phone size={18} />}<span>{online ? 'Kết thúc hội thoại' : busy ? 'Hủy kết nối' : 'Bắt đầu trò chuyện'}</span></button><button className={`mic-button ${mic ? '' : 'muted'}`} onClick={() => void toggleMic()} aria-label={mic ? 'Tắt microphone' : 'Bật microphone'} aria-pressed={mic}>{mic ? <Mic size={19} /> : <MicOff size={19} />}</button>{online && <button className="interrupt-button" disabled={agent !== 'speaking'} onClick={() => void client.interrupt().catch(() => setError('Chưa ngắt được lời. Thử nói qua micro.'))} aria-label="Ngắt lời trợ lý"><Square size={15} /></button>}</div>
            <p className="input-hint"><AudioLines size={13} />{online ? mic ? 'Micro đang bật. Bạn có thể nói để ngắt lời trợ lý.' : 'Micro đang tắt. Bạn vẫn có thể gửi tin nhắn.' : 'Bật kết nối để trò chuyện bằng giọng nói hoặc tin nhắn.'}</p>
          </div>
        </aside>
      </section>
      <footer className="app-footer"><button onClick={() => showSettings(true)}><Settings2 size={14} /> Thiết bị & chuyển động</button></footer>
    </main>
    {settings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) showSettings(false); }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-title"><div><div className="eyebrow">CÁ NHÂN HÓA TRẢI NGHIỆM</div><h2 id="settings-title">Thiết bị & chuyển động</h2></div><button className="icon-button" onClick={() => showSettings(false)} aria-label="Đóng cài đặt"><X size={20} /></button></div>
      <label className="field">Mã truy cập ứng dụng<input type="password" value={access} onChange={event => setAccess(event.target.value)} placeholder={config?.auth_required ? 'Nhập mã do quản trị viên cung cấp' : 'Không bắt buộc trên localhost'} autoComplete="off" /></label><p className="field-note">Mã chỉ giữ trong bộ nhớ tab; khóa dịch vụ được cấu hình trên server.</p>
      <label className="field">Microphone<select value={input} onChange={event => { const id = event.target.value; setInput(id); void client.device('audioinput', id).catch(() => setError('Không đổi được microphone.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audioinput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></label>
      <label className="field">Loa / tai nghe<select value={output} onChange={event => { const id = event.target.value; setOutput(id); void client.device('audiooutput', id).catch(() => setError('Trình duyệt chưa hỗ trợ đổi loa.')); }}><option value="">Thiết bị mặc định</option>{devices.filter(device => device.kind === 'audiooutput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Loa ${i + 1}`}</option>)}</select></label>
      <div className="setting-switch"><div><strong>Cử động đầu khi nói</strong><p>Nghiêng nhẹ, có khoảng nghỉ giữa các nhịp</p></div><input type="checkbox" checked={options.motion} onChange={event => changeOption('motion', event.target.checked)} aria-label="Cử động đầu khi nói" /></div>
      <label className="range-field"><span>Mức cử động đầu <output>{Math.round(options.intensity * 100)}%</output></span><input aria-label="Mức cử động đầu" type="range" min="0.5" max="1.4" step="0.1" value={options.intensity} onChange={event => changeOption('intensity', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ há hàm <output>{Math.round(options.jaw * 100)}%</output></span><input aria-label="Độ há hàm" type="range" min="0.6" max="1.2" step="0.05" value={options.jaw} onChange={event => changeOption('jaw', Number(event.target.value))} /></label>
      <label className="range-field"><span>Độ trễ môi <output>{options.delay} ms</output></span><input aria-label="Độ trễ môi" type="range" min="0" max="200" step="10" value={options.delay} onChange={event => changeOption('delay', Number(event.target.value))} /></label><p className="field-note">Miệng đi trước tiếng: tăng độ trễ. Khẩu hình trong từ vẫn là ước lượng, được điều tiết theo âm thanh đang phát.</p>
      <button className="save-settings" onClick={() => showSettings(false)}><Check size={17} /> Xong</button>
    </section></div>}
  </div>;
}
