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

## Sửa lỗi Disconnected — cùng ngày

Log Edge cho thấy WebSocket signaling thành công nhưng ICE thất bại sau khoảng
15 giây. Worker Python vào phòng được; browser chưa chuyển sang participant active.
UDP socket thực tế ở IP LAN `:7882`, trong khi cấu hình ép candidate về loopback.

- Bỏ `rtc.node_ip: 127.0.0.1` và cờ ép node-ip trong launcher Windows native.
- Giữ signaling ở localhost; RTC tự chọn đúng card mạng, không hardcode IP máy.
- Giữ lỗi gốc khi SDK phát Disconnected trước khi connect() reject, để không
  ghi đè lỗi ICE/auth bằng thông báo chung.
- Worker đóng sạch khi browser rời phòng trong lúc chờ kết nối.
- 13 backend tests và 13 frontend tests qua; production build qua.
- Test hai peer WebRTC thật qua text/audio PCM qua sau khi đổi cấu hình.
- Với cấu hình khóa đã có trên máy tại lần sửa này, một phiên HTTP → LiveKit →
  named worker → Soniox TTS đã nhận được audio lời chào thực tế; cleanup HTTP 204.
  Test này chưa bao gồm một lượt microphone STT → LLM đầy đủ.
- Không có browser điều khiển được, nên chưa kiểm tra lại phát trực tiếp trên Edge.
