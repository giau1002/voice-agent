# Thử khẩu hình MuseTalk 1.5 trên server L40S

## Chạy trên server đã vượt qua kiểm tra CUDA

Giải nén `avatar-musetalk-pilot.zip` vào thư mục riêng. Script tự tìm môi trường
CUDA trong `.runtime` hiện tại hoặc trong các thư mục cùng cấp. Ví dụ
`C:\rg\avatar-musetalk-pilot` dùng được môi trường ở `C:\rg\avatar-gpu-check\.runtime`.
Không cần chuyển hoặc tải lại môi trường. Mở PowerShell tại thư mục MuseTalk:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-model.ps1
```

Nếu môi trường CUDA nằm ở nơi khác hoặc tìm thấy nhiều môi trường, chỉ định
thư mục đã chạy thành công `setup.ps1` (thay ví dụ bằng đường dẫn thực tế):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-model.ps1 -RuntimePath "C:\rg\avatar-gpu-check"
```

Script cài thêm dependency suy luận vào môi trường riêng, tải khoảng **3,71 GiB**
trọng số từ Hugging Face, đối chiếu checksum, rồi dựng câu chào tiếng Việt 6,5 giây.
Không cần quyền quản trị, không cần API key trên server. Không dừng các tiến trình
đang dùng GPU. Cần ít nhất 15 GiB dung lượng đĩa trống.

Kết quả nằm trong `outputs/<lần-chạy>/`:

- `index.html`: mở bằng trình duyệt để xem video và số liệu.
- `pilot.mp4`: nhân vật đọc câu thử bằng giọng Soniox Nina đã tạo từ chatbot.
- `report.json`: thời gian, FPS, VRAM và lỗi nếu có.
- `blend-mask.png`, `frames/`: phục vụ kiểm tra vùng ghép và từng khung hình.

Gửi lại **pilot.mp4 và report.json**. Nếu cài đặt lỗi, gửi phần cuối
`logs/setup-model.log`. Không gửi `.env` hay khóa API.

Chạy lại không cần tải/cài lại:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run-pilot.ps1
```

Thử file lời nói khác (tối đa 25 giây, audio xử lý tại server):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run-pilot.ps1 -Audio "D:\Audio\cau-thu.wav"
```

## Chính xác bản thử này làm gì

Đây là **bước đánh giá mô hình**, chưa thay giao diện chatbot bằng clip. Mục tiêu
sản phẩm vẫn là nhân vật trên web nhận lời nói TTS mới, dựng và phát đồng bộ
qua LiveKit. Chỉ ghép vào luồng trực tiếp khi chất lượng và tốc độ thực tế đạt yêu cầu.

Ở bước này đầu và mắt giữ nguyên, tập trung vào lỗi môi/răng/má. Dùng đúng ảnh
nhân vật đã có trong dự án và một vùng mặt cố định được hiệu chỉnh cho ảnh đó.
Không dùng khuôn mặt của người trong video tham khảo. Crop cố định không hỗ trợ
ảnh khác hoặc xoay đầu lớn; khi thêm chuyển động đầu cần tracking/hiệu chỉnh lại.

Mô hình dựng vùng mặt 256×256 theo âm thanh; kích thước video đầu ra 560×700
không làm tăng độ phân giải suy luận. Việc mặt có mờ, méo hoặc đường ghép phải
đánh giá bằng kết quả thực, không thể kết luận từ unit test hay tên GPU.

## Công nghệ

- MuseTalk 1.5: mạng UNet dựng khẩu hình từ đặc trưng âm thanh.
- SD VAE và Whisper tiny: mã hóa/giải mã ảnh và đặc trưng âm thanh.
- BiSeNet: mask vùng mặt để pha trộn; OpenCV/Pillow: xử lý khung hình.
- PyTorch 2.0.1/cu118, FP16, batch 2: dùng môi trường CUDA vừa kiểm tra.
- FFmpeg (qua imageio-ffmpeg): đóng gói H.264/AAC; không dùng chuỗi lệnh shell.
- Soniox: chỉ tạo sẵn câu thử ở máy phát triển; gói chuyển đi chỉ có WAV, không có key.

Dependency dùng cho training, Gradio, MMPose không cài ở pilot cố định này.
Source MuseTalk được giữ nguyên; runner riêng gọi các lớp inference và dùng
crop đã hiệu chỉnh thay bước tự nhận diện mặt. `models-manifest.json` cố định
commit nguồn, revision và checksum từng tệp trước khi nạp.

## Đọc số liệu

`model_only_fps` chỉ đo UNet + VAE sau một lượt làm nóng; không tính tải model,
chuẩn bị chân dung, đặc trưng audio, pha trộn, ghi đĩa, mạng và phát lại.
`render_blend_write_fps` có tính pha trộn và ghi khung, vẫn chưa phải tốc độ
hội thoại đầu cuối. Báo cáo này chưa đo độ trễ streaming hay đồng bộ LiveKit.

Probe CUDA của server đã báo 19.534 MiB VRAM trống tại thời điểm kiểm tra.
Pilot kiểm tra lại ngay trước khi chạy, yêu cầu ít nhất 8 GiB trống và giới hạn
caching allocator tối đa 12 GiB hoặc thấp hơn theo VRAM còn lại. CUDA context
có overhead riêng; đây không phải cơ chế cách ly GPU khỏi các tiến trình khác.
Nếu thiếu bộ nhớ, script ghi lỗi và dừng, không tắt tiến trình khác.

Nguồn và giấy phép upstream nằm trong `.runtime/MuseTalk/LICENSE`:
[MuseTalk](https://github.com/TMElyralab/MuseTalk),
[model MuseTalk](https://huggingface.co/TMElyralab/MuseTalk),
[VAE](https://huggingface.co/stabilityai/sd-vae-ft-mse),
[Whisper tiny](https://huggingface.co/openai/whisper-tiny).
