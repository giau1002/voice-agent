# Chạy avatar trong chatbot LiveKit

Đây là cập nhật từ mẫu đã được duyệt trên L40S. GPU giữ model trong bộ nhớ và nhận
âm thanh mới của từng câu; không phát lại `review.mp4`. Bản đầu phục vụ **một phiên
hội thoại**. Phiên thứ hai nhận báo bận, không chia sẻ trạng thái khuôn mặt.

## 1. Server L40S

Giải nén `avatar-flashhead-live-update.zip` **đè các file mã nguồn vào đúng thư mục
FlashHead đã chạy benchmark**, nơi có `.runtime`, `inputs` và `manifest.json`.
Giữ nguyên `.runtime`: không giải nén vào thư mục MuseTalk hoặc một thư mục trống.

Mở PowerShell trong thư mục đó:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1 -BindAddress 0.0.0.0 -Port 8890
```

Script cài thêm aiohttp, dùng lại Python/CUDA/weights hiện có, kiểm tra hash và
nạp model một lần. Khi thấy `FlashHead ready`, dịch vụ đã sẵn sàng.
Khóa kết nối được tạo tại `.runtime/renderer-token.txt`; giữ file này riêng tư.
Không gửi khóa qua chat hoặc đưa vào frontend.

Máy chatbot cần truy cập được IP server qua TCP 8890. Với hai mạng khác nhau,
dùng mạng riêng/VPN hoặc reverse proxy HTTPS; HTTP chỉ dùng trong mạng tin cậy.
Script không tự mở firewall hay sửa tiến trình đang chạy. Đóng cửa sổ server
sẽ dừng avatar.

## 2. Máy chạy chatbot

Cài dependency theo `uv.lock`, build web rồi cấu hình `.env`:

```dotenv
AVATAR_MODE=flashhead
AVATAR_RENDERER_URL=http://IP-SERVER-GPU:8890
AVATAR_RENDERER_TOKEN=<nội dung renderer-token.txt>
```

Khởi động lại API và worker của voice-agent. Mở web, bấm **Kết nối**.
Video được publish bởi chính worker vào phòng LiveKit hiện có, cùng track âm thanh;
không cần thêm participant, không cần cho server GPU truy cập cổng LiveKit.
Khóa và địa chỉ GPU không xuất hiện trong `/api/config` hay mã JavaScript.

Khung web giữ ảnh gốc 560×700 và cùng cách cover/căn ảnh khi chưa kết nối. Video
512×512 chứa toàn bộ đầu–vai được đặt lại đúng vùng crop `[125,25,445,345]` trong
ảnh gốc, với viền alpha mềm. Không kéo video vuông ra toàn bộ khung nhân vật.
Phần thân và nền ngoài crop vẫn là ảnh gốc; không tuyên bố model sinh chuyển động
toàn thân. `web/public/avatar/live-framing.json` là cấu hình chung cho web và bộ
đóng gói input. Khi đổi ảnh/crop, phải cập nhật cả input GPU theo cấu hình đó.

Để quay về ảnh 2D: đặt `AVATAR_MODE=photo`, khởi động lại API/worker.

## Luồng hoạt động

`TTS → resample 16 kHz mono → buffer 0,96 giây → FlashHead → JPEG nội bộ →
worker giải mã → LiveKit video + audio → trình duyệt`.

JPEG quality 94, không giảm mẫu màu. Đây là thêm một bước nén so với bản benchmark;
cần xem chất lượng ở kích thước kiosk. Không ghi âm, JPEG hay MP4 trong đường chạy
hội thoại. Truyền worker–GPU cần băng thông cao hơn luồng WebRTC đã mã hóa tới web.

Worker giữ hàng đợi TTS có giới hạn và tối đa hai chunk đang dựng/tải hoặc đợi
phát ngoài chunk hiện tại. Request GPU vẫn theo đúng thứ tự, nhưng đoạn kế tiếp
được dựng sau khi nhận header của đoạn trước, trong lúc body ảnh còn đang tải.
Vì vậy thời gian dựng và tải không cộng nối tiếp ở mọi đoạn như bản đầu.

Âm thanh dùng hàng đợi native 240 ms, cấp theo khối 20 ms; video có hàng đợi năm
khung và đồng hồ 25 FPS riêng. Có đệm khởi đầu 180 ms. Không đợi vẽ từng khung
xong rồi mới cấp 40 ms tiếng, vì cách đó dễ làm thiết bị âm thanh cạn dữ liệu.
Khi mạng/GPU không theo kịp lâu dài, bộ đệm hữu hạn vẫn có thể cạn; cần đo chứ
không tăng bộ đệm vô hạn. SDK nhận sự kiện bắt đầu/kết thúc để đồng bộ phụ đề.

Với AnyDesk Forward Tunnel, server có thể bind `127.0.0.1:8890`, máy chatbot
forward local `18890` tới remote `127.0.0.1:8890`, rồi đặt
`AVATAR_RENDERER_URL=http://127.0.0.1:18890`. Giữ tunnel đang hoạt động.

Trong thời gian chờ, GPU nhận silence để tiếp tục chuyển động. Khi ngắt lời,
worker xóa âm thanh đang đệm, bỏ hình chưa phát và tăng epoch để bỏ kết quả GPU
cũ. Engine giữ trạng thái chuyển động gần nhất thay vì trở về ảnh gốc. Do có
chunk dựng trước, chuyển tư thế lúc ngắt lời cần kiểm tra thực tế; chưa hứa chuyển
tiếp liền mạch ở mọi thời điểm. Phiên mới reset toàn bộ cache.

Một đoạn cuối câu được pad silence đến hết cửa sổ 0,96 giây để giữ liên tục với
trạng thái sinh hình. Thời gian lời đã phát báo cho SDK chỉ tính mẫu audio thật.
Ngắt lời vẫn có thể cắt đoạn đệm này.

## Kiểm tra trên server trước khi sử dụng chính thức

- Nói câu ngắn và câu dài; kiểm tra đầu câu không mất tiếng, cuối câu không bị cắt.
- Ngắt bằng giọng nói/nút Ngắt lời ở đầu, giữa và cuối câu; không nghe lại câu cũ.
- Mất mạng/dừng server: phiên báo lỗi, không âm thầm phát tiếng với hình sai.
- Đo thời gian từ PCM đầu tới lúc phát trên trình duyệt; số 84–85 FPS benchmark
  chưa bao gồm HTTP/JPEG, encode LiveKit hoặc trình duyệt.
- Thử hội thoại 10 phút, reconnect và hai cửa sổ; kiểm tra VRAM/giải phóng lease.

Tham khảo API chính thức:
[LiveKit media sources](https://docs.livekit.io/transport/media/raw-tracks/),
[avatar output](https://docs.livekit.io/agents/models/avatar/).
