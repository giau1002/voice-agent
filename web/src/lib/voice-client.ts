import { Room, RoomEvent, Track, type RemoteParticipant, type Participant, type RemoteTrack } from 'livekit-client';
import { AudioMeter } from './audio-meter';

export type AgentState = 'idle' | 'initializing' | 'listening' | 'thinking' | 'speaking';
export type LinkState = 'offline' | 'connecting' | 'connected' | 'reconnecting';
export interface Message { id: string; role: 'assistant' | 'user'; text: string; final: boolean }
export interface ClientEvents {
  link: (state: LinkState) => void;
  agent: (state: AgentState) => void;
  message: (message: Message) => void;
  text: (chunk: string, final: boolean) => void;
  interrupt: () => void;
  error: (message: string) => void;
  playback: (allowed: boolean) => void;
  quality: (value: string) => void;
  ended: () => void;
}
export interface Session {
  session_id: string; session_key: string; token: string; url: string;
  room: string; identity: string; max_seconds: number;
}

async function detailError(response: Response): Promise<Error> {
  try {
    const data = await response.json();
    if (data.detail?.missing) return new Error('Cần cấu hình: ' + data.detail.missing.join(', '));
    if (typeof data.detail === 'string') return new Error(data.detail);
  } catch { /* Non-JSON upstream error. */ }
  return new Error(`Yêu cầu thất bại (${response.status})`);
}

export class VoiceClient {
  readonly meter = new AudioMeter();
  private room: Room | null = null;
  private session: Session | null = null;
  private generation = 0;
  private access = '';
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private waiting: ReturnType<typeof setTimeout> | null = null;
  private audio = new Map<string, HTMLMediaElement[]>();
  private aborter: AbortController | null = null;
  private userSpeaking = false;
  private agentSpeaking = false;

  constructor(private events: ClientEvents) {}

  get connected() { return this.room?.state === 'connected'; }
  get speaking() { return this.agentSpeaking && !this.userSpeaking && !!this.room?.canPlaybackAudio; }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.access ? { Authorization: `Bearer ${this.access}` } : {}) };
  }

  async connect(access: string, microphone: boolean, inputDevice: string) {
    await this.disconnect();
    const generation = ++this.generation;
    this.access = access;
    this.aborter = new AbortController();
    this.events.link('connecting');
    try {
      await this.meter.unlock();
      const response = await fetch('/api/sessions', {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ display_name: 'Khách' }),
        signal: this.aborter.signal,
      });
      if (!response.ok) throw await detailError(response);
      const session: Session = await response.json();
      if (generation !== this.generation) { await this.releaseSession(session); return; }
      this.session = session;
      const room = new Room({
        adaptiveStream: true, dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          deviceId: inputDevice || undefined },
      });
      this.room = room;
      const current = () => generation === this.generation && this.room === room;
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (current() && participant.isAgent && track.kind === Track.Kind.Audio) this.attachAudio(track, participant);
      });
      room.on(RoomEvent.TrackUnsubscribed, track => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(element => element.remove());
          this.audio.delete(track.sid || 'audio'); this.meter.detach();
        }
      });
      room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        if (current() && participant.isAgent) this.updateAgent(participant.attributes['lk.agent.state']);
      });
      room.on(RoomEvent.ParticipantConnected, participant => {
        if (current() && participant.isAgent) { this.clearWaiting(); this.updateAgent(participant.attributes['lk.agent.state']); }
      });
      room.on(RoomEvent.ParticipantDisconnected, participant => {
        if (current() && participant.isAgent) {
          this.events.error('Agent đã ngắt kết nối. Kết thúc phiên và thử kết nối lại.');
          void this.disconnect();
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (current()) this.events.playback(room.canPlaybackAudio); });
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (current() && (participant.isLocal || participant.isAgent)) this.events.quality(quality);
      });
      room.on(RoomEvent.Reconnecting, () => { if (current()) { this.agentSpeaking = false; this.events.interrupt(); this.events.link('reconnecting'); } });
      room.on(RoomEvent.Reconnected, () => { if (current()) this.events.link('connected'); });
      room.on(RoomEvent.Disconnected, () => {
        if (current()) { this.events.error('Phiên đã mất kết nối.'); void this.disconnect(); }
      });
      room.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
        if (!current() || !participant?.isAgent || topic !== 'portrait') return;
        try {
          const event = JSON.parse(new TextDecoder().decode(data));
          if (event.type === 'agent.state') this.updateAgent(event.payload.state);
          if (event.type === 'user.state') {
            this.userSpeaking = event.payload.state === 'speaking';
            if (this.userSpeaking) this.events.interrupt();
          }
          if (event.type === 'agent.error') this.events.error(String(event.payload.message || 'Agent gặp lỗi.'));
          if (event.type === 'session.expired') { this.events.error('Phiên đã hết thời gian. Bạn có thể mở phiên mới.'); void this.disconnect(); }
        } catch { /* Ignore unrecognized data envelopes. */ }
      });
      room.registerTextStreamHandler('lk.transcription', (reader, info) => {
        void (async () => {
          const participant: Participant | undefined = info.identity === room.localParticipant.identity
            ? room.localParticipant : room.remoteParticipants.get(info.identity);
          if (!participant || (!participant.isAgent && !participant.isLocal)) return;
          const role = participant.isAgent ? 'assistant' : 'user';
          const messageId = info.identity + ':' + (reader.info.attributes?.['lk.segment_id'] || reader.info.id);
          let text = '';
          try {
            for await (const delta of reader) {
              if (!current()) return;
              text += delta;
              this.events.message({ id: messageId, role, text, final: false });
              if (role === 'assistant') this.events.text(delta, false);
            }
            if (!current()) return;
            this.events.message({ id: messageId, role, text,
              final: role === 'assistant' || reader.info.attributes?.['lk.transcription_final'] === 'true' });
            if (role === 'assistant') this.events.text('', true);
          } catch { if (current()) this.events.error('Một đoạn phụ đề đã bị gián đoạn.'); }
        })();
      });
      await room.connect(session.url, session.token);
      if (!current()) { await room.disconnect(); return; }
      await room.startAudio();
      if (microphone) {
        try { await room.localParticipant.setMicrophoneEnabled(true); }
        catch { this.events.error('Chưa mở được microphone. Vẫn có thể nhập nội dung bằng bàn phím.'); }
      }
      if (!current()) return;
      this.events.link('connected'); this.events.agent('initializing');
      const agent = [...room.remoteParticipants.values()].find(participant => participant.isAgent);
      if (agent) this.updateAgent(agent.attributes['lk.agent.state']);
      else this.waiting = setTimeout(() => {
        if (current() && ![...room.remoteParticipants.values()].some(p => p.isAgent)) this.events.error('Phòng đã kết nối nhưng chưa có worker. Chạy python -m voice_agent.worker dev và kiểm tra cấu hình.');
      }, 20000);
      this.deadline = setTimeout(() => {
        if (current()) { this.events.error('Đã hết thời gian phiên.'); void this.disconnect(); }
      }, session.max_seconds * 1000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.events.error(error instanceof Error ? error.message : 'Không kết nối được LiveKit.');
      await this.disconnect();
    }
  }

  private clearWaiting() { if (this.waiting) clearTimeout(this.waiting); this.waiting = null; }
  private updateAgent(state?: string) {
    if (!['idle', 'initializing', 'listening', 'thinking', 'speaking'].includes(state || '')) return;
    this.clearWaiting();
    this.agentSpeaking = state === 'speaking';
    if (!this.agentSpeaking) this.events.interrupt();
    this.events.agent(state as AgentState);
  }

  private attachAudio(track: RemoteTrack, _participant: RemoteParticipant) {
    const element = track.attach();
    element.autoplay = true; element.setAttribute('playsinline', 'true');
    element.className = 'agent-audio'; document.body.append(element);
    this.audio.set(track.sid || 'audio', [element]);
    this.meter.attach(track.mediaStreamTrack);
  }

  async playAudio() { await this.meter.unlock(); await this.room?.startAudio(); }
  async setMicrophone(enabled: boolean) { await this.room?.localParticipant.setMicrophoneEnabled(enabled); }
  async device(kind: MediaDeviceKind, id: string) { await this.room?.switchActiveDevice(kind, id || 'default'); }
  microphoneEnabled() { return this.room?.localParticipant.isMicrophoneEnabled ?? false; }

  async sendText(text: string) {
    if (!this.connected || !this.room) throw new Error('Hãy kết nối trước khi gửi.');
    const value = text.trim();
    if (!value || value.length > 2000) throw new Error('Nhập từ 1 đến 2.000 ký tự.');
    await this.interrupt();
    await this.room.localParticipant.sendText(value, { topic: 'lk.chat' });
    this.events.message({ id: crypto.randomUUID(), role: 'user', text: value, final: true });
  }

  async interrupt() {
    this.agentSpeaking = false; this.events.interrupt();
    const agent = this.room && [...this.room.remoteParticipants.values()].find(p => p.isAgent);
    if (agent && this.room) await this.room.localParticipant.performRpc({
      destinationIdentity: agent.identity, method: 'portrait.interrupt', payload: '', responseTimeout: 5,
    });
  }

  private async releaseSession(session: Session) {
    try {
      const response = await fetch(`/api/sessions/${session.session_id}`, {
        method: 'DELETE', headers: { ...this.headers(), 'X-Session-Key': session.session_key },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) this.events.error('Chưa xác nhận được việc đóng phòng. Worker có giới hạn thời gian tự dừng.');
    } catch { this.events.error('Không liên lạc được server để đóng phòng. Phiên sẽ tự hết hạn.'); }
  }

  async disconnect() {
    ++this.generation; this.aborter?.abort(); this.aborter = null;
    this.clearWaiting(); if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
    const room = this.room, session = this.session;
    this.room = null; this.session = null;
    this.agentSpeaking = false; this.userSpeaking = false;
    this.meter.close();
    for (const elements of this.audio.values()) elements.forEach(element => { element.pause(); element.srcObject = null; element.remove(); });
    this.audio.clear(); this.events.interrupt(); this.events.link('offline'); this.events.agent('idle'); this.events.ended();
    if (room) { room.removeAllListeners(); await room.disconnect(); }
    if (session) await this.releaseSession(session);
  }
}
