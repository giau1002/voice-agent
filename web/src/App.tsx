import { useEffect, useRef, useState } from 'react';
import { AudioLines, ArrowUpRight, Check, CircleHelp, Headphones, LoaderCircle, Mic, MicOff, MonitorSpeaker, Phone, PhoneOff, Send, Settings2, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { Portrait, type PortraitOptions } from './components/Portrait';
import { VoiceClient, type AgentState, type LinkState, type Message } from './lib/voice-client';
import { LipSync } from './lib/lip-sync';

interface Config {
  auth_required: boolean; configured: boolean; missing: string[]; language: string;
  providers: { transport: string; stt: string; tts: string; llm: string; vad: string };
}
const stateLabels: Record<AgentState, string> = { idle: 'Sẵn sàng trò chuyện', initializing: 'Đang gọi trợ lý', listening: 'Tôi đang lắng nghe', thinking: 'Đang nghĩ câu trả lời', speaking: 'Trợ lý đang nói' };
const quick = ['Xin chào, bạn có thể giúp tôi những gì?', 'Hãy hướng dẫn tôi từng bước.', 'Bạn có thể giải thích đơn giản hơn không?'];

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
  const [quality, setQuality] = useState('');
  const [sending, setSending] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [options, setOptions] = useState<PortraitOptions>({
    motion: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    intensity: 1, jaw: 1, delay: 60,
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
  const caption = [...messages].reverse().find(message => message.role === 'assistant')?.text;
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

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-icon"><AudioLines size={24} /></span>voice<span>agent</span><span className="brand-version">STUDIO / 01</span></a><div className="top-actions"><span className="privacy"><ShieldCheck size={14} /> Kết nối trực tiếp qua WebRTC</span><button className="icon-button" onClick={() => showSettings(true)} aria-label="Mở cài đặt"><Settings2 size={19} /></button></div></header>
    <main>
      <section className="intro"><div><div className="eyebrow">LẮNG NGHE. HIỂU. HỒI ĐÁP.</div><h1>Một cuộc trò chuyện.<br /><span>Gần gũi hơn.</span></h1></div><p>Nói điều bạn cần, theo cách của bạn.<br />Trợ lý lắng nghe và trả lời bằng giọng nói,<br />cùng một gương mặt biết tương tác.</p></section>
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Đóng thông báo"><X size={16} /></button></div>}
      {config && !config.configured && <div className="notice setup-notice"><Settings2 size={18} /><span>Chưa sẵn sàng kết nối: cần điền <strong>{config.missing.join(', ')}</strong> trong file .env của server.</span><button onClick={() => void refreshConfig()}>Kiểm tra lại</button></div>}
      <section className="workspace">
        <div className="stage-panel"><div className="panel-top"><span>PORTRAIT / LIVE CONVERSATION</span><span className={`status-dot ${online ? 'live' : ''}`}>{online ? 'ĐÃ KẾT NỐI' : busy ? 'ĐANG KẾT NỐI' : 'CHƯA KẾT NỐI'}</span></div>
          <div className="stage"><Portrait client={client} lips={lips} options={options} onLevel={setLevel} />
            <div className="stage-caption"><span className="caption-kicker">{online ? 'TRỢ LÝ CỦA BẠN' : 'SẴN SÀNG KHI BẠN CẦN'}</span><p>{online ? caption || 'Xin chào, tôi đang sẵn sàng lắng nghe.' : 'Bắt đầu bằng một lời chào.'}</p><div className="audio-wave" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: 3 + level * (12 + (i % 5) * 6) }} />)}</div></div>
          </div><div className="stage-footer"><span><span className={`small-dot ${agent === 'speaking' ? 'active' : ''}`} />{title}</span><span>Chớp mắt tự nhiên · 2–3 giây</span></div>
        </div>
        <aside className="conversation-panel"><div className="conversation-heading"><div><div className="eyebrow">KHÔNG GIAN HỘI THOẠI</div><h2>Bạn muốn hỏi điều gì?</h2></div><span className="session-icon"><Headphones size={21} /></span></div>
          <p className="lead">Bật micro để trò chuyện, hoặc nhập tin nhắn. Bạn có thể ngắt lời khi trợ lý đang nói.</p>
          <div className="call-controls"><button className={`connect-button ${online ? 'connected' : ''}`} onClick={() => void connect()} disabled={!!config && !config.configured && link === 'offline'}>{busy ? <LoaderCircle size={18} className="spin" /> : online ? <PhoneOff size={18} /> : <Phone size={18} />}<span>{online ? 'Kết thúc hội thoại' : busy ? 'Hủy kết nối' : 'Bắt đầu trò chuyện'}</span>{!online && !busy && <ArrowUpRight size={18} />}</button><button className={`mic-button ${mic ? '' : 'muted'}`} onClick={() => void toggleMic()} aria-label={mic ? 'Tắt microphone' : 'Bật microphone'} aria-pressed={mic}>{mic ? <Mic size={19} /> : <MicOff size={19} />}</button></div>
          {!playback && online && <button className="playback-button" onClick={() => void client.playAudio().catch(() => setError('Chưa phát được âm thanh. Kiểm tra quyền phát tiếng.'))}><Volume2 size={16} /> Bấm để bật âm thanh trả lời</button>}
          <div className="conversation-toolbar"><span><span className="small-dot" /> {online ? 'Đang diễn ra' : 'Hội thoại mới'}</span>{online && <button disabled={agent !== 'speaking'} onClick={() => void client.interrupt().catch(() => setError('Chưa ngắt được lời. Thử nói qua micro.'))}><Square size={11} /> Ngắt lời</button>}{!online && messages.length > 0 && <button onClick={() => setMessages([])}>Xóa nội dung</button>}</div>
          <div className="messages" ref={transcript} role="log" aria-label="Nội dung hội thoại">
            {messages.length === 0 ? <div className="empty-state"><span className="empty-icon"><AudioLines size={30} strokeWidth={1.3} /></span><h3>Chúng ta bắt đầu nhé?</h3><p>Kết nối rồi nói hoặc gõ một câu.<br />Nội dung trao đổi sẽ xuất hiện tại đây.</p><div className="suggestions">{quick.map((value, i) => <button key={value} onClick={() => { setText(value); if (online) void send(value); }}><span>0{i + 1}</span>{value}<ArrowUpRight size={14} /></button>)}</div></div> : messages.map(message => <article className={`message ${message.role}`} key={message.id}><span className="message-label">{message.role === 'assistant' ? 'TRỢ LÝ' : 'BẠN'}</span><p>{message.text}{!message.final && <span className="typing-cursor" />}</p></article>)}
            {agent === 'thinking' && <div className="thinking"><i /><i /><i /><span>Trợ lý đang suy nghĩ</span></div>}
          </div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="chat-input">Nội dung tin nhắn</label><textarea id="chat-input" value={text} onChange={event => setText(event.target.value)} placeholder="Nhập điều bạn muốn hỏi…" maxLength={2000} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button type="submit" disabled={!online || !text.trim() || sending} aria-label="Gửi tin nhắn">{sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>
          <div className="composer-note"><ShieldCheck size={12} /><span>Nội dung chỉ hiển thị trong phiên trên thiết bị này.</span></div>
        </aside>
      </section>
      <section className="connection-strip"><div><MonitorSpeaker size={18} /><span>Âm thanh hai chiều</span><strong>LiveKit WebRTC</strong></div><div><Mic size={18} /><span>Nghe & đọc</span><strong>Soniox STT / TTS</strong></div><div><AudioLines size={18} /><span>Trạng thái</span><strong>{online ? quality || 'Đã kết nối' : 'Chờ kết nối'}</strong></div><button onClick={() => showSettings(true)}>Thiết bị & chuyển động <Settings2 size={15} /></button></section>
    </main>
    <footer><span>voice agent <i>/</i> A face to talk to.</span><span>Giọng nói thật · Nhân vật 2.5D · v0.1.0</span></footer>
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
