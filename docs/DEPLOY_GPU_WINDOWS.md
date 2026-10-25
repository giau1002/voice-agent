# Chạy web và voice worker trên máy GPU Windows đang có FlashHead

Hướng dẫn này dành cho server đã chạy được FlashHead, có `.runtime`, weights,
ảnh nguồn và token renderer. Web/API, LiveKit và voice worker chạy từ repo này;
dịch vụ FlashHead hiện có tiếp tục chạy trong thư mục cũ.

## Lấy mã và cài dependency

Lần đầu, mở PowerShell tại thư mục muốn đặt dự án:

```powershell
git clone https://github.com/giau1002/voice-agent.git
cd voice-agent
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
```

Nếu đã có checkout, vào thư mục `voice-agent` rồi chạy:

```powershell
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
```

Setup cài Node/uv/Python/LiveKit khi thiếu, cài dependency theo lockfile và build
giao diện. `.env` đã có được giữ lại; nếu chưa có, setup tạo từ `.env.example`.
Không dùng `.venv`, `node_modules` hoặc đường dẫn `.tools` từ máy phát triển.

## Cấu hình trên server

Điền `SONIOX_API_KEY` và `GEMINI_API_KEY` trong `.env`. Các key không nằm trên
Git. Kiểm tra các giá trị sau để dùng cấu hình mới:

```dotenv
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-3.1-flash-lite
SONIOX_STT_MODEL=stt-rt-v4
SONIOX_MAX_ENDPOINT_DELAY_MS=1000
WEB_SEARCH_ENABLED=false
WEB_SEARCH_MODEL=gemini-3.1-flash-lite
WEB_SEARCH_FAST_RESPONSES=true
WEB_SEARCH_TIMEOUT_SECONDS=8

LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_SERVER_URL=
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret

AVATAR_MODE=flashhead
AVATAR_RENDERER_URL=http://127.0.0.1:8890
AVATAR_RENDERER_TOKEN=<token của renderer trên server này>
```

Lấy token từ `.runtime/renderer-token.txt` trong thư mục FlashHead hiện có.
Nếu `.env` trước đó đặt `WEB_SEARCH_ENABLED=true`, đổi lại `false` rồi restart
API và worker để áp dụng việc tạm tắt tìm kiếm. OCR vẫn dùng `GEMINI_API_KEY`.
Nếu renderer chạy cổng khác, sửa `AVATAR_RENDERER_URL` cho đúng. Khi cùng máy,
dùng địa chỉ renderer trực tiếp; không dùng địa chỉ forward tunnel từ máy cũ.
Giữ nguyên thư mục weights và môi trường GPU đã cài.

## Khởi động

Nếu đã dùng commit `394da11` với STT v5, chạy trong checkout sau `git pull`:

```powershell
.venv\Scripts\python.exe scripts/restore-voice-config.py
```

Lệnh chỉ đặt lại model STT và thời gian chốt lượt trong `.env`. Cấu hình tăng
tốc tìm kiếm chỉ áp dụng cho công cụ web; LLM hội thoại dùng cấu hình cũ.

Nếu FlashHead chưa chạy, mở PowerShell trong thư mục FlashHead cũ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -BindAddress 127.0.0.1 -Port 8890
```

Sau khi renderer sẵn sàng, mở PowerShell khác trong checkout `voice-agent`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
```

Mở `http://127.0.0.1:8790` bằng trình duyệt trên server. Cho phép micro, bấm
**Bắt đầu trò chuyện**, nói một câu ngắn và kiểm tra chữ nhận dạng dưới nhân vật
rồi nghe trợ lý trả lời. Sau cập nhật mã web, tải lại trang bằng Ctrl+F5.
Log chạy bằng script nằm ở `logs/worker.out.log`, `logs/worker.err.log` và log API.

Các URL localhost ở trên dành cho trình duyệt chạy trên cùng server. Nếu kiosk
mở web từ máy khác, dùng cấu hình HTTPS/WSS và địa chỉ RTC truy cập được theo
[hướng dẫn triển khai](DEPLOY.md); `127.0.0.1` khi đó trỏ về máy kiosk.

Chỉ renderer sử dụng môi trường CUDA/weights. Voice worker vẫn gọi Soniox và
Gemini qua mạng; chuyển cả ứng dụng sang máy GPU không biến STT/LLM/TTS thành
dịch vụ chạy offline.
