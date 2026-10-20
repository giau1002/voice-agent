# Kiểm chứng bản đầu — 2026-10-20

Đã chạy trên Windows với Python 3.12.15, Node.js 24.22.0, LiveKit Server 1.13.10.

| Hạng mục | Kết quả |
|---|---|
| Backend unit/contract | 11 passed |
| Frontend lifecycle/lip-sync/UI | 11 passed |
| TypeScript và production web build | Passed |
| HTTP API + HTML + ảnh/atlas cùng origin | HTTP 200 |
| LiveKit thật: hai peer truyền text và audio PCM tổng hợp, cleanup phòng | Passed |
| Worker đăng ký named agent `portrait-voice` với server thật | Passed |
| Silero VAD CPU load | Passed |
| Windows setup script, tải dependency/model và build | Passed |
| Windows start script, mở API/worker/server và tự dừng sau smoke window | Passed |
| Git staged file audit: không có .env, .tools, venv hoặc node_modules | Passed |

Giới hạn:

- Chưa có SONIOX_API_KEY và khóa LLM trong môi trường kiểm tra, nên chưa chạy
  hội thoại STT → LLM → TTS với tài khoản dịch vụ thật.
- Không có bề mặt trình duyệt điều khiển được trong môi trường kiểm tra; chưa
  xác nhận microphone/autoplay/đổi loa và chất lượng khẩu hình bằng phát browser.
- Docker không có trên máy này; Dockerfile/Compose đã chuẩn bị nhưng chưa build/run.
- CI được cấu hình; kết quả CI trên GitHub phải xem ở tab Actions sau push.
- Không coi unit tests hoặc audio PCM tổng hợp là bằng chứng chất lượng giọng,
  độ trễ thực tế hoặc khẩu hình khớp từng âm.
