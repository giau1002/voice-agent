# Contract tích hợp

## HTTP (API và web cùng origin)

- `GET /api/health`: liveness, không trả secrets.
- `GET /api/config`: tên provider, ngôn ngữ, tên biến còn thiếu, yêu cầu mã ứng dụng.
- `POST /api/sessions`: body `{ "display_name": "Khách" }`, Authorization
  `Bearer <APP_ACCESS_TOKEN>` khi cấu hình; trả token LiveKit, URL, room, identity,
  `session_id`, `session_key`, `max_seconds`. Không lưu response vào localStorage.
- `DELETE /api/sessions/{session_id}`: Authorization như trên và
  `X-Session-Key` của phiên; xóa đúng phòng do API đã tạo.

## LiveKit

- Audio browser → agent: microphone track, PCM qua WebRTC, Soniox STT.
- Audio agent → browser: Soniox PCM 24 kHz mono, publish audio track qua LiveKit.
- Gửi text: `room.localParticipant.sendText(value, { topic: 'lk.chat' })`.
- Transcript: text stream `lk.transcription`. Agent phát delta, user STT có thể
  phát bản tích lũy nhiều stream dùng chung `lk.segment_id`; UI upsert cùng message.
  `lk.transcription_final` chỉ trạng thái chốt user transcript.
- State chuẩn: participant attribute `lk.agent.state`.
- Ngắt lời chủ động: RPC `portrait.interrupt` tới agent identity. Worker xác thực
  caller đúng participant của phòng. Nói qua microphone được Silero/LiveKit xử lý.

Topic data `portrait`, envelope `{ type, payload }`:

| type | payload |
|---|---|
| `agent.state` | `{ state: 'initializing'\|'idle'\|'listening'\|'thinking'\|'speaking' }` |
| `user.state` | `{ state: 'speaking'\|'listening'\|'away' }` |
| `agent.error` | `{ code, message }`, thông báo đã lọc, không chuyển exception/key |
| `session.expired` | `{ message }` |

Web chỉ tin envelope/transcript từ participant được LiveKit nhận diện là agent.
Không bắt audio microphone để nhép miệng nhân vật. Đây là điểm khác quan trọng
so với nút microphone của demo cũ chỉ thử theo âm lượng người dùng.

## ML và đồng bộ avatar

Silero VAD CPU → speech detection và hỗ trợ interruption. Soniox xử lý STT/TTS
trên dịch vụ. LLM cấu hình theo provider, chưa có RAG hoặc bộ dữ liệu nghiệp vụ.
Renderer dùng ảnh/atlas đã dựng sẵn, không suy luận model hình ảnh theo khung.

LiveKit đồng bộ transcript theo playout. Soniox adapter hiện không phát word/
phoneme timestamps. LipSync dùng chữ để chọn dáng môi, PCM nhận được để đóng/
mở theo nhịp. Không chứng nhận khẩu hình khớp từng âm. Nếu cần độ khớp phoneme
cao hơn, thay provider adapter có timing hoặc bổ sung aligner, giữ nguyên lớp
transport/room và API. Không dùng SpeechSynthesis hoặc phát clip mẫu trên web.
