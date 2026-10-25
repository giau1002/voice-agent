# Kiểm tra GPU cho avatar chân dung

Đây là bước chuẩn bị môi trường CUDA, **chưa phải bản avatar hoàn chỉnh**.
Chạy trên server NVIDIA, không chạy trên máy kiosk AMD.

## Thực hiện

1. Chuyển `avatar-gpu-check.zip` sang server bằng chức năng truyền file AnyDesk.
2. Giải nén vào thư mục riêng, ví dụ `D:\AvatarGPU`.
3. Mở PowerShell trong thư mục vừa giải nén và chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

Không cần mở PowerShell quyền quản trị. ExecutionPolicy chỉ áp dụng cho tiến
trình này. Lần đầu cần Internet và vài GB dung lượng để tải Python/PyTorch.
Gửi lại `cuda-report.json`; nếu lỗi cài đặt, gửi phần cuối `logs/setup.log`.
Không gửi `.env`, mật khẩu hay khóa API.

## Phạm vi

- Dùng uv 0.13.3 có SHA-256 đối chiếu bản phát hành chính thức.
- Python 3.10.19 và PyTorch 2.0.1/cu118 nằm trong `.runtime` riêng.
- Phiên bản PyTorch theo hướng dẫn cài đặt MuseTalk; CUDA runtime của wheel
  không cần trùng số phiên bản CUDA tối đa in trên `nvidia-smi`.
- Không sửa Python hiện có, driver, CUDA Toolkit, firewall hay dịch vụ khác.
- Không kết thúc tiến trình, không tải mô hình và không gửi ảnh lên dịch vụ.
- Kiểm tra FP16, phép nhân ma trận, convolution và CUDA; cấp phát tensor nhỏ.
  Giới hạn caching allocator của probe ở 10% VRAM; CUDA context có overhead riêng.
- Thời gian convolution không phải FPS avatar. Chưa có benchmark MuseTalk.

## Cấu hình người dùng cung cấp ngày 21/10/2026

- NVIDIA L40S, driver 573.48, chế độ TCC.
- 46.068 MiB tổng VRAM; 25.788 MiB đã dùng; còn 20.280 MiB (~19,8 GiB).
- Có `llama-server.exe` và một tiến trình Python đang chiếm GPU. Không dừng chúng.
- Đã quan sát Task Manager qua AnyDesk: khoảng 128 GB RAM, 24 nhân / 48 luồng.
- Chưa xác nhận CUDA trong Python trên server, VRAM có thể thay đổi theo tải.

## Hướng triển khai sau khi kiểm tra CUDA

Thử MuseTalk 1.5 với chân dung của dự án và lời nói tiếng Việt, kiểm tra
miệng/răng, chất lượng biên mặt, VRAM đỉnh và tốc độ dựng thực tế. Chỉ khi đạt
chất lượng mới ghép audio/video vào LiveKit. Cử động đầu/mắt cần nguồn chuyển
động riêng; MuseTalk chủ yếu xử lý khẩu hình, không tự giải quyết mọi chuyển động.
Video dùng để đánh giá mô hình là bước thử; sản phẩm cuối vẫn là chatbot web
đối thoại trực tiếp. Không thay bằng clip cố định và gọi đó là AI trực tiếp.

Nguồn: [MuseTalk chính thức](https://github.com/TMElyralab/MuseTalk),
[uv 0.13.3](https://github.com/astral-sh/uv/releases/tag/0.13.3).
