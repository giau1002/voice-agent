# FlashHead Lite: kết quả L40S ngày 22/10/2026

**Quyết định:** dùng cấu hình này làm mốc để tích hợp avatar vào chatbot. Người dùng
đã xem mẫu và đánh giá “quá tốt ấy chứ”. Đây là chấp nhận chất lượng của mẫu thử
6,495 giây; chưa phải nghiệm thu hội thoại trực tiếp hoặc vận hành nhiều kiosk.

Kết quả gốc: `artifacts/20261022-111014-3084a2/`.
Bản sao báo cáo máy: [flashhead-l40s-20261022.json](benchmarks/flashhead-l40s-20261022.json).
Không sửa `quality_accepted=null` trong báo cáo gốc; ý kiến người dùng được ghi riêng ở đây.

## Số đo thực tế

Windows, NVIDIA L40S, Python 3.10.19, PyTorch 2.7.1+cu128. Dùng SDPA có sẵn,
tắt `torch.compile`, FlashHead **Lite** commit
`9bc03de06bb0de82cd6bc477804512ae06144bf2`.

| Chỉ số | Kết quả |
|---|---:|
| Video đầu ra | 512×512, 25 FPS, 163 khung |
| Âm thanh thử | 6,495375 giây, tiếng Việt |
| Lượt đo sau warm-up | 2 lượt × 7 chunk |
| Tốc độ dựng lượt 1 / lượt 2 | 84,24 / 84,98 FPS |
| Thời gian trung bình / chunk 0,96 giây | 0,284 giây |
| Khoảng thời gian xử lý các chunk | 0,278–0,292 giây |
| P95 chunk lượt 1 / lượt 2 | 0,290 / 0,285 giây |
| RTF lượt 1 / lượt 2 | 0,297 / 0,294 |
| Tổng tính toán mỗi lượt | 1,994 / 1,977 giây |
| PyTorch VRAM allocated tối đa | 4,98 GiB |
| PyTorch VRAM reserved tối đa | 5,54 GiB |
| Nạp model | 5,45 giây |
| Chuẩn bị ảnh | 0,38 giây |
| Warm-up chunk đầu | 0,44 giây |

FPS dựng gồm đặc trưng audio, sinh hình và đưa RGB về CPU; chưa gồm mã hóa mạng,
LiveKit hoặc trình duyệt. Video phát 25 FPS, không phải 85 FPS. Mẫu này có dư địa
tính toán khoảng 3,4 lần thời gian phát nhưng chưa chứng minh được số phiên đồng thời.
VRAM trên là số PyTorch theo dõi, không phải toàn bộ bộ nhớ CUDA của tiến trình.

Lời nói được đệm thành 7 chunk = 6,72 giây xử lý, sau đó cắt khung đệm cuối cho
bản xem. Vì vậy không suy ra thời gian xử lý lời nói thật bằng FPS và 163 khung
một cách trực tiếp. `total_wall_s=27,58` bao gồm khởi động, kiểm tra, hai lượt chạy
và xuất video; không phải độ trễ trả lời của chatbot.

## Chất lượng và độ trễ

Người dùng duyệt chất lượng mẫu video. Kiểm tra các khung tại 0, 1, 2, 3, 4, 5, 6
và 6,48 giây cho thấy nhiều khẩu hình, răng xuất hiện khi mở miệng và có chớp mắt
ở khoảng giây thứ 2. Ảnh trích khung không đủ để kết luận độ mượt theo thời gian
hoặc độ khớp âm/vần; phần này dựa trên đánh giá xem video của người dùng.

Hai mô phỏng trong report đều không bị thiếu chunk ở mẫu ngắn này:

- Nếu PCM đến đúng tốc độ phát: cặp hình/tiếng đầu sẵn sàng khoảng 1,246 giây;
  cộng buffer mô phỏng 120 ms thì bắt đầu phát khoảng 1,366 giây.
- Nếu PCM đã có sẵn: cặp đầu sẵn sàng khoảng 0,286 giây; cộng buffer thì khoảng
  0,406 giây. TTS thực tế có thể cấp PCM với tốc độ khác hai giả định này.

Đây vẫn là **mô phỏng**, chưa đo từ lúc người dùng nói xong và chưa bao gồm
STT/LLM/TTS, mã hóa, mạng hay thiết bị phát. Không dùng các con số đó để quảng bá
độ trễ chatbot hoàn chỉnh.

## Bước tích hợp dựa trên kết quả này

1. Giữ nguyên ảnh crop, seed, weights và cấu hình sinh hình đã được duyệt.
   Giữ model và ảnh đã mã hóa trong GPU để tái sử dụng qua các lượt nói.
2. Cấp PCM từ TTS vào adapter, ghép video và audio theo cùng mốc thời gian rồi
   publish qua LiveKit. Trình duyệt hiển thị video sinh trực tiếp trong vùng avatar.
3. Kiểm tra ngắt lời: xóa hàng đợi cả hình lẫn tiếng, loại kết quả thuộc lượt nói
   cũ; kiểm tra chuyển động khi bắt đầu nói, ngừng nói và về trạng thái chờ.
4. Đo hội thoại dài, cold/warm, thời gian bắt đầu phát và đồng bộ A/V trong trình
   duyệt trên mạng thực. Chỉ sau đó thay chế độ mặc định của kiosk.

Chưa tích hợp LiveKit trong phép thử này. Không thay bản 2D đang hoạt động bằng
một clip phát sẵn.

## Dấu vết kiểm tra

SHA-256:

```text
report.json  cc26ce629b09dee683ab56a5006e0bac8ecf04ef501ceab029c624bbf9eb0ee5
review.mp4   e53cc0c5765bee5aecdd69d89ea6c0b71c26ff4e100dc633b98a7e9b13c3e4ab
```
