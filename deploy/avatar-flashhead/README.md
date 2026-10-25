# Avatar tự chạy — thử tính khả thi của FlashHead Lite

Đây là bộ đánh giá và dịch vụ dựng avatar cho kiosk. Mẫu ngày 22/10/2026 đã được
người dùng duyệt trên L40S: 84–85 FPS dựng ở video 25 FPS. Không cần tài khoản hoặc API avatar trả phí.
Mã nguồn dùng mô hình đã huấn luyện công khai; không huấn luyện một mô hình nền từ đầu.

**Tích hợp chatbot:** xem [LIVE.md](LIVE.md) và chạy `serve.ps1` sau khi đã cài
weights. Luồng HTTP/JPEG + LiveKit đã được kiểm tra ở máy phát triển bằng dữ liệu
giả lập; vẫn cần chạy hội thoại thực trên L40S và mạng của anh.

## Chạy trên server Windows NVIDIA

Giải nén `avatar-flashhead-research.zip` vào **thư mục mới**, ví dụ
`C:\rg\avatar-flashhead`. Mở PowerShell ở thư mục vừa giải nén:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

- Python và PyTorch riêng trong `.runtime`; không dùng lại môi trường MuseTalk.
- Tải khoảng 7,60 GiB trọng số, cộng các gói Python/CUDA. Nên có 30 GiB đĩa trống.
- NVIDIA hỗ trợ BF16; runner kiểm tra ít nhất 14 GiB VRAM trống. Giới hạn allocator
  tối đa 16 GiB hoặc VRAM trống trừ 2 GiB. Đây là giới hạn thử nghiệm, không phải số
  VRAM đã đo; CUDA có overhead riêng. Không tắt tiến trình đang chạy trên server.
- Setup kiểm tra CUDA/BF16, attention và convolution nhỏ trước khi tải trọng số.
  Nếu kiểm tra thất bại, dừng tại đó và xem `logs/setup.log`.
- PyTorch 2.7.1 CUDA 12.8, SDPA sẵn trong PyTorch. Bỏ các phụ thuộc nhiều GPU/NCCL,
  FlashAttention ngoài và torch.compile trong bản thử Windows.
- Không gọi TTS trả phí: dùng lại WAV tiếng Việt đã có. Ảnh và âm thanh xử lý tại máy.
- Setup chỉ tải từ GitHub, PyTorch, PyPI và Hugging Face; inference chạy offline.

Chạy lại sau cài đặt, hoặc thử WAV PCM16 của anh (tối đa 20 giây):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -Audio "D:\Audio\test.wav"
```

## Xem kết quả

Mở `outputs/<lần-chạy>/index.html` bằng trình duyệt. Thư mục có:

- `review.mp4`: bản ghi chất lượng, không phải clip để thay chatbot.
- `portrait-input.png`: lấy cả đầu và vai từ ảnh gốc; không cắt ghép riêng miệng.
- `report.json`: thời gian cold load, warm-up, từng chunk, VRAM và mô phỏng hàng đợi.

`execution_ok=true` chỉ xác nhận suy luận/xuất video thành công. `quality_accepted`
để trống cho tới khi xem video; không tự chấm chất lượng bằng FPS.

Ảnh hiện có 560×700; vùng chân dung được đưa về 512×512. Việc phóng ảnh không tạo
thêm chi tiết thật. Mô hình có thể làm đổi nét mặt hoặc nền; phải xem kết quả.

## Đo tốc độ đúng

Code nguồn tạo 33 khung, dùng 9 khung làm lịch sử và xuất **24 khung mới/lần**.
Tại 25 FPS, mỗi chunk mới dài **0,96 giây**, PCM16 mono 16 kHz, 15.360 mẫu.
Khác với con số cửa sổ 1,32 giây trong bài nghiên cứu, đây là bước tiến luồng trong
commit đã ghim. Không tùy tiện giảm chunk vì có ràng buộc của VAE và mô hình.

Runner giữ model trong RAM/VRAM, warm-up một chunk, rồi đo hai lượt. Mỗi chunk đo:
đặc trưng âm thanh + mô hình + chuyển RGB uint8 về CPU. Ghi MP4 thực hiện sau cả
lượt đo. MP4 không nằm trên đường xử lý mà adapter dự kiến nối vào LiveKit.

- `rtf_compute_over_output < 1`: máy dựng nhanh hơn thời lượng phát của mẫu thử.
- `p95_chunk_s`: phát hiện những đoạn xử lý chậm dù FPS trung bình cao.
- `pcm_at_1x_simulation`: giả định PCM đến với tốc độ phát thực.
- `pcm_ready_upfront_simulation`: PCM đã có sẵn, cho thấy giới hạn khi TTS tạo nhanh.
- Hai mục trên là **mô phỏng**, chưa đo mã hóa video, mạng hay trình duyệt.

Mục tiêu chọn bản tích hợp: RTF dưới 0,8 trên lời nói dài, không có lỗi răng/môi rõ,
giữ danh tính nhân vật. Đây là tiêu chí đề xuất, **chưa phải kết quả đạt được**.
Tốc độ 96 FPS của tác giả dùng cấu hình tối ưu khác; không áp dụng thẳng cho bản này.

## Phần sẽ nối vào web sau khi đạt

`PCM TTS → chunker → FlashHead giữ trạng thái → hàng đợi hình/tiếng cùng timestamp
→ LiveKit/WebRTC → video trong giao diện kiosk`.

Phần đã viết: chunker giữ mẫu, reset epoch, adapter render RGB+PCM, benchmark.
Đã bổ sung dịch vụ một phiên, LiveKit output ở worker, silence khi idle và bỏ
kết quả cũ bằng epoch khi ngắt lời. Chưa hỗ trợ nhiều phiên GPU đồng thời và chưa
kiểm chứng chuyển động idle/ngắt lời hoặc đồng bộ phát trên mạng triển khai thực.

Không tuyên bố chất lượng ngang dịch vụ thương mại trước khi thử bằng đúng ảnh,
giọng tiếng Việt và máy L40S. Báo cáo nghiên cứu trong repo:
`docs/SELF_HOSTED_AVATAR_RESEARCH.md`.
