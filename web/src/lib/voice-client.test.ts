import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], connect: null as null | Promise<void>, fetch: vi.fn() }));
vi.mock('./audio-meter', () => ({ AudioMeter: class {
  unlock = vi.fn().mockResolvedValue(undefined); attach = vi.fn(); detach = vi.fn(); close = vi.fn(); sample() { return .4; }
} }));
vi.mock('livekit-client', () => ({
  Track: { Kind: { Audio: 'audio' } },
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
    connect() { return mocks.connect || Promise.resolve(); }
  },
}));
import { VoiceClient, type ClientEvents } from './voice-client';

const session = { session_id: 'session', session_key: 'session-control', token: 'room-token', url: 'ws://localhost:7880', identity: 'user', room: 'room', max_seconds: 1800 };
function events(): ClientEvents {
  return Object.fromEntries(['link', 'agent', 'message', 'text', 'interrupt', 'error', 'playback', 'quality', 'ended'].map(name => [name, vi.fn()])) as unknown as ClientEvents;
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
  mocks.rooms.length = 0; mocks.connect = null; mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE'
    ? new Response(null, { status: 204 }) : new Response(JSON.stringify(session), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('voice transport lifecycle', () => {
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
});
