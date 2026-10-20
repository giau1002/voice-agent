# Vận hành

## Linux hoặc LiveKit Cloud

1. Chọn một LiveKit project/server có WSS và WebRTC truy cập được từ máy kiosk.
2. Điền các khóa trong `.env`. Không dùng devkey/devsecret trên Internet.
3. Đặt `APP_ENV=production`, `APP_ACCESS_TOKEN` ngẫu nhiên dài ít nhất 32 ký tự,
   `ALLOWED_ORIGINS=https://your-domain.example` và `LIVEKIT_URL=wss://...`.
4. `docker compose up --build -d api worker`. Đặt reverse proxy HTTPS trước
   `127.0.0.1:8790`. Cấu hình timeout và giới hạn request/rate ở ingress.
5. Trên giao diện, mở Cài đặt và nhập APP_ACCESS_TOKEN. Đây là mã ứng dụng
   dành cho kiosk/operator, không phải provider API key. Mã chỉ giữ trong bộ nhớ tab.

Không có module tài khoản đa người dùng/RBAC; nếu cần SaaS nhiều tenant, bổ sung
xác thực tổ chức và quota theo người dùng trước khi mở công khai. Limiter hiện
6 lần tạo phiên/phút/IP, lưu trong một tiến trình; nhiều replica cần limiter
chung ở reverse proxy hoặc Redis. Không tin `X-Forwarded-For` từ client trực tiếp.
Nếu proxy cần forward IP, chỉ tin IP của proxy do bạn kiểm soát.

API chỉ cấp token, không xác nhận worker/provider đã online. `/api/config` báo
đủ biến cấu hình; không phải phép thử sức khỏe Soniox/LLM. Worker offline được
báo trên giao diện sau khi chờ trong phòng. `/api/health` chỉ là liveness API.

## Docker local

Trong `.env` giữ:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_SERVER_URL=ws://livekit:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
APP_ACCESS_TOKEN=<mã ngẫu nhiên 32+ ký tự>
ALLOWED_ORIGINS=http://127.0.0.1:8790,http://localhost:8790
```

Rồi `docker compose --profile local up --build -d`.
Cấu hình local chỉ quảng bá ICE 127.0.0.1, phục vụ browser trên cùng máy;
không dùng nguyên cấu hình này cho LAN hoặc VPS. Cloud không cần profile local.

## Mạng và thiết bị

- LiveKit Cloud: WSS/TLS và UDP/TURN theo cấu hình project.
- LiveKit self-hosted: mở đúng signaling, RTC UDP/TCP và TURN theo tài liệu
  [self-hosting](https://docs.livekit.io/home/self-hosting/deployment/).
- Web/API và worker là tiến trình riêng. Token không chứa khóa provider.
- Trên kiosk bật quyền micro và loa. Không dùng Windows native server cho
  production có autoscaling; server không có đầy đủ CPU capacity metrics trên Windows.
- Echo cancellation cần luồng audio thực sự được phát qua browser; dùng tai nghe
  khi tinh chỉnh VAD/interruption để tránh tiếng loa lọt vào microphone.

## Vòng đời và bảo mật

Mỗi phiên có phòng riêng, identity riêng, token join 10 phút và session control
key riêng để đóng phòng. Token hết hạn ngăn join lại; không tự ngắt peer đang
kết nối. Worker tự đóng sau SESSION_MAX_SECONDS (mặc định 30 phút).
Kết thúc hội thoại: dừng local track, audio context, reader callbacks, rồi gọi
API xóa phòng. Nếu cleanup API thất bại, worker vẫn giới hạn thời gian; LiveKit
close-on-disconnect xử lý client rời phòng. Token không có quyền roomAdmin.

API không ghi nội dung hội thoại vào database/file. Giao diện giữ tối đa 200
message trong bộ nhớ, xóa khi reload. Tuy nhiên dữ liệu giọng/text được gửi tới
LiveKit, Soniox và LLM đã cấu hình; chính sách lưu trữ của các dịch vụ đó phải
được kiểm tra theo hợp đồng triển khai của bạn. Tránh bật debug log payload
ở production nếu có thông tin cá nhân.

## Khi lỗi

| Hiện tượng | Kiểm tra |
|---|---|
| Nút bắt đầu bị khóa | Điền đúng khóa `.env`, restart API, bấm Kiểm tra lại |
| Phòng có kết nối nhưng không có agent | Worker đang chạy; agent name giống LIVEKIT_AGENT_NAME; credentials cùng project |
| Có chữ không có tiếng | Bật playback; kiểm tra Soniox voice/model, loa và quyền autoplay |
| Agent không nhận giọng | Micro có quyền, track có publish, Soniox key/endpointing, log worker |
| Agent tự ngắt vì tiếng loa | Tai nghe; echoCancellation; kiểm tra vị trí mic/loa |
| Khẩu hình đi trước tiếng | Tăng độ trễ môi trong Cài đặt; đây chưa phải forced alignment |
| Kết nối ICE thất bại | IP quảng bá, firewall UDP/TCP/TURN, browser có truy cập LiveKit được không |
| Lỗi 401 | Nhập APP_ACCESS_TOKEN của API trong phần Cài đặt |
| Lỗi 403 | ALLOWED_ORIGINS hoặc truy cập LAN khi chưa đặt APP_ACCESS_TOKEN |

README và `docs/CONTRACT.md` mô tả điểm nối nghiệp vụ. Nên thêm retrieval,
tool schema, audit và kiểm thử nghiệp vụ theo lĩnh vực ở lớp Agent; tránh đưa
quy tắc nghiệp vụ vào renderer.
