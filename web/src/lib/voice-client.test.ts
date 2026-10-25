import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], connect: null as null | Promise<void>, fetch: vi.fn(), failIce: false }));
vi.mock('./audio-meter', () => ({ AudioMeter: class {
  unlock = vi.fn().mockResolvedValue(undefined); attach = vi.fn(); detach = vi.fn(); close = vi.fn(); sample() { return .4; }
} }));
vi.mock('livekit-client', () => ({
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
  RoomEvent: Object.fromEntries(['TrackSubscribed', 'TrackUnsubscribed', 'ParticipantAttributesChanged', 'ParticipantConnected', 'ParticipantDisconnected', 'AudioPlaybackStatusChanged', 'ConnectionQualityChanged', 'Reconnecting', 'Reconnected', 'Disconnected', 'DataReceived'].map(name => [name, name])),
  Room: class {
    handlers = new Map<string, (...args: any[]) => void>();
    streams = new Map<string, (...args: any[]) => void>();
    state = 'connected'; canPlaybackAudio = true;
    remoteParticipants = new Map([['agent', { identity: 'agent', isAgent: true, attributes: { 'lk.agent.state': 'listening' } }]]);
    localParticipant = { identity: 'user', isLocal: true, isAgent: false, isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { this.localParticipant.isMicrophoneEnabled = enabled; }),
      sendText: vi.fn().mockResolvedValue(undefined), performRpc: vi.fn().mockResolvedValue('ok') };
    startAudio = vi.fn().mockResolvedValue(undefined); switchActiveDevice = vi.fn().mockResolvedValue(true);
    disconnect = vi.fn(async () => { this.state = 'disconnected'; });
    removeAllListeners() { this.handlers.clear(); }
    constructor() { mocks.rooms.push(this); }
    on(event: string, callback: (...args: any[]) => void) { this.handlers.set(event, callback); }
    registerTextStreamHandler(topic: string, callback: (...args: any[]) => void) { this.streams.set(topic, callback); }
    connect() {
      if (mocks.failIce) {
        this.handlers.get('Disconnected')?.();
        return Promise.reject(new Error('could not establish pc connection'));
      }
      return mocks.connect || Promise.resolve();
    }
  },
}));
import { VoiceClient, connectionError, type ClientEvents } from './voice-client';
import { emptyForm } from './demo-form';

const session = { session_id: 'session', session_key: 'session-control', token: 'room-token', url: 'ws://localhost:7880', identity: 'user', room: 'room', max_seconds: 1800 };
function events(): ClientEvents {
  return Object.fromEntries(['link', 'agent', 'message', 'text', 'interrupt', 'error', 'playback', 'quality', 'ended'].map(name => [name, vi.fn()])) as unknown as ClientEvents;
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
  mocks.rooms.length = 0; mocks.connect = null; mocks.failIce = false; mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE'
    ? new Response(null, { status: 204 }) : new Response(JSON.stringify(session), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('voice transport lifecycle', () => {
  it('sends form commands to the agent with the current revision and returns its state', async () => {
    const callbacks = { ...events(), form: vi.fn() }, client = new VoiceClient(callbacks);
    const draft = emptyForm(); draft.fields.full_name = 'Nguyễn An';
    await expect(client.formCommand('start', draft)).rejects.toThrow('Kết nối');
    await client.connect('', false, '');
    const state = { ...draft, active: true, revision: 1 };
    const room = mocks.rooms[0];
    room.localParticipant.performRpc.mockResolvedValue(JSON.stringify(state));
    await expect(client.formCommand('start', draft)).resolves.toEqual(state);
    const command = room.localParticipant.performRpc.mock.calls.at(-1)[0];
    expect(command.method).toBe('portrait.form');
    expect(JSON.parse(command.payload)).toMatchObject({ action: 'start', expected_revision: 0, fields: { full_name: 'Nguyễn An' } });
    expect(callbacks.form).toHaveBeenLastCalledWith(state);
    await client.disconnect();
  });

  it('only accepts valid form streams from the current room agent', async () => {
    const callbacks = { ...events(), form: vi.fn() }, client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    const handler = mocks.rooms[0].streams.get('portrait.form');
    const state = { ...emptyForm(), active: true, revision: 1 };
    const reader = (payload: unknown) => ({ async *[Symbol.asyncIterator]() { yield JSON.stringify(payload); } });
    handler(reader(state), { identity: 'other' });
    handler(reader({ active: true }), { identity: 'agent' });
    await flush();
    expect(callbacks.form).not.toHaveBeenCalled();
    handler(reader(state), { identity: 'agent' });
    await flush();
    expect(callbacks.form).toHaveBeenLastCalledWith(state);
    await client.disconnect(); callbacks.form.mockClear();
    handler(reader(state), { identity: 'agent' });
    await flush();
    expect(callbacks.form).not.toHaveBeenCalled();
  });

  it('shows only the agent avatar video and clears it on unsubscribe/disconnect', async () => {
    const callbacks = { ...events(), video: vi.fn() }, client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    const room = mocks.rooms[0], video = { kind: 'video' };
    const subscribed = room.handlers.get('TrackSubscribed');
    callbacks.video.mockClear();
    subscribed(video, { trackName: 'avatar-video' }, { isAgent: false });
    subscribed(video, { trackName: 'unrelated-camera' }, { isAgent: true });
    expect(callbacks.video).not.toHaveBeenCalled();
    subscribed(video, { trackName: 'avatar-video' }, { isAgent: true });
    expect(callbacks.video).toHaveBeenLastCalledWith(video);
    room.handlers.get('TrackUnsubscribed')(video);
    expect(callbacks.video).toHaveBeenLastCalledWith(null);
    subscribed(video, { trackName: 'avatar-video' }, { isAgent: true });
    await client.disconnect();
    expect(callbacks.video).toHaveBeenLastCalledWith(null);
    subscribed(video, { trackName: 'avatar-video' }, { isAgent: true });
    expect(callbacks.video).toHaveBeenLastCalledWith(null);
  });

  it('preserves the ICE failure when SDK emits Disconnected before connect rejects', async () => {
    mocks.failIce = true;
    const callbacks = events(), client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    expect(callbacks.error).toHaveBeenCalledTimes(1);
    expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining('WebRTC (ICE)'));
    expect(callbacks.link).toHaveBeenLastCalledWith('offline');
    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/sessions/session', expect.objectContaining({ method: 'DELETE' }));
  });

  it('distinguishes token rejection from a transport failure', () => {
    expect(connectionError(new Error('401 Unauthorized'))).toContain('token');
    expect(connectionError(new Error('custom error'))).toBe('custom error');
  });

  it('connects mic, scopes chat to lk.chat and interrupts agent before sending', async () => {
    const callbacks = events(), client = new VoiceClient(callbacks);
    await client.connect('access', true, 'mic-1');
    const room = mocks.rooms[0];
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await client.sendText('Xin chào');
    expect(room.localParticipant.performRpc).toHaveBeenCalledWith(expect.objectContaining({ method: 'portrait.interrupt', destinationIdentity: 'agent' }));
    expect(room.localParticipant.sendText).toHaveBeenCalledWith('Xin chào', { topic: 'lk.chat' });
    expect(callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', text: 'Xin chào' }));
    await client.disconnect();
    expect(room.disconnect).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/sessions/session', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'X-Session-Key': 'session-control' }) }));
  });

  it('rejects empty/oversized text and never sends while offline', async () => {
    const client = new VoiceClient(events());
    await expect(client.sendText('hello')).rejects.toThrow('kết nối');
    await client.connect('', false, '');
    await expect(client.sendText(' ')).rejects.toThrow('2.000');
    await expect(client.sendText('a'.repeat(2001))).rejects.toThrow('2.000');
    await client.disconnect();
  });

  it('cancels an in-flight connect without reopening microphone', async () => {
    let resolve!: () => void;
    mocks.connect = new Promise<void>(r => { resolve = r; });
    const callbacks = events(), client = new VoiceClient(callbacks);
    const pending = client.connect('', true, '');
    await flush();
    const room = mocks.rooms[0]; expect(room).toBeDefined();
    await client.disconnect(); resolve(); await pending;
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(callbacks.link).not.toHaveBeenLastCalledWith('connected');
  });

  it('recovers session cleanup after provider/network failures', async () => {
    const callbacks = events(), client = new VoiceClient(callbacks);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { missing: ['SONIOX_API_KEY'] } }), { status: 503 }));
    await client.connect('', true, '');
    expect(callbacks.error).toHaveBeenCalledWith('Cần cấu hình: SONIOX_API_KEY');
    expect(callbacks.link).toHaveBeenLastCalledWith('offline');
  });

  it('only drives lips from agent transcript, reuses STT segment IDs, and clears on barge-in', async () => {
    const callbacks = events(), client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    const room = mocks.rooms[0], handler = room.streams.get('lk.transcription');
    const reader = (id: string, text: string, attributes: Record<string, string> = {}) => ({
      info: { id, attributes }, async *[Symbol.asyncIterator]() { yield text; },
    });
    handler(reader('one', 'Xin chào ', { 'lk.segment_id': 'segment' }), { identity: 'agent' });
    await flush();
    expect(callbacks.text).toHaveBeenCalledWith('Xin chào ', false);
    handler(reader('stt-a', 'tôi muốn', { 'lk.segment_id': 'user-segment' }), { identity: 'user' });
    await flush();
    handler(reader('stt-b', 'tôi muốn hỏi', { 'lk.segment_id': 'user-segment', 'lk.transcription_final': 'true' }), { identity: 'user' });
    await flush();
    expect(callbacks.message).toHaveBeenLastCalledWith({ id: 'user:user-segment', role: 'user', text: 'tôi muốn hỏi', final: true });
    expect(callbacks.text).not.toHaveBeenCalledWith('tôi muốn hỏi', false);
    room.handlers.get('DataReceived')(new TextEncoder().encode(JSON.stringify({ type: 'agent.state', payload: { state: 'speaking' } })), { isAgent: true }, 0, 'portrait');
    expect(client.speaking).toBe(true);
    room.handlers.get('DataReceived')(new TextEncoder().encode(JSON.stringify({ type: 'user.state', payload: { state: 'speaking' } })), { isAgent: true }, 0, 'portrait');
    expect(client.speaking).toBe(false); expect(callbacks.interrupt).toHaveBeenCalled();
    await client.disconnect();
  });

  it('accepts source streams only from the current agent and keeps them out of lip sync', async () => {
    const callbacks = events(), client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    const room = mocks.rooms[0], handler = room.streams.get('portrait.sources');
    const payload = JSON.stringify({ status: 'ok', query: 'Câu hỏi', answer: 'Đã kiểm tra.',
      sources: [{ title: 'Nguồn', url: 'https://example.vn' }], suggestions_html: '', checked_at: '2026-10-20T19:00:00+07:00' });
    const reader = () => ({ info: { id: 'lookup-1' }, async *[Symbol.asyncIterator]() { yield payload; } });
    handler(reader(), { identity: 'user' }); await flush();
    expect(callbacks.message).not.toHaveBeenCalled();
    handler(reader(), { identity: 'agent' }); await flush();
    expect(callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ id: 'lookup:lookup-1',
      lookup: expect.objectContaining({ query: 'Câu hỏi' }) }));
    expect(callbacks.text).not.toHaveBeenCalled();
    callbacks.message = vi.fn();
    await client.disconnect();
    handler(reader(), { identity: 'agent' }); await flush();
    expect(callbacks.message).not.toHaveBeenCalled();
  });

  it('shows interim and final STT over agent data when no transcription stream arrives', async () => {
    const callbacks = events(), client = new VoiceClient(callbacks);
    await client.connect('', false, '');
    const room = mocks.rooms[0];
    const receive = room.handlers.get('DataReceived');
    const packet = (text: string, final: boolean) => new TextEncoder().encode(JSON.stringify({
      type: 'user.transcript', payload: { id: 'utterance', text, final },
    }));
    receive(packet('Tôi muốn', false), { isAgent: false }, 0, 'portrait');
    expect(callbacks.message).not.toHaveBeenCalled();
    receive(packet('Tôi muốn', false), { isAgent: true }, 0, 'portrait');
    expect(callbacks.message).toHaveBeenLastCalledWith({ id: 'stt:utterance', role: 'user', text: 'Tôi muốn', final: false });
    receive(packet('Tôi muốn làm giấy khai sinh', true), { isAgent: true }, 0, 'portrait');
    expect(callbacks.message).toHaveBeenLastCalledWith({ id: 'stt:utterance', role: 'user', text: 'Tôi muốn làm giấy khai sinh', final: true });
    const streams = room.streams.get('lk.transcription');
    streams({ info: { id: 'late-stream', attributes: {} }, async *[Symbol.asyncIterator]() { yield 'Tôi'; } }, { identity: 'user' });
    await flush();
    expect(callbacks.message).toHaveBeenLastCalledWith({ id: 'stt:utterance', role: 'user', text: 'Tôi muốn làm giấy khai sinh', final: true });
    expect(callbacks.text).not.toHaveBeenCalled();
    await client.disconnect();
    vi.mocked(callbacks.message).mockClear();
    receive(packet('Phiên cũ', true), { isAgent: true }, 0, 'portrait');
    expect(callbacks.message).not.toHaveBeenCalled();
  });
});
