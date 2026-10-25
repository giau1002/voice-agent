# Micro có tiếng nhưng không có phản hồi — 25/10/2026

WebSocket LiveKit HTTP 101 và Pending là trạng thái kết nối đang mở. Lời chào
có thể phát dù đường nhận dạng micro đang chậm, nên không dùng lời chào làm
bằng chứng STT hoạt động.

Đã kiểm tra bằng âm thanh lời chào công khai trong cache, gửi như một track
micro thật qua API tạo phiên và LiveKit đang chạy; không ghi âm micro người dùng.
WebRTC transport riêng cũng đạt kiểm tra truyền text/audio và đóng phòng.

Trước chỉnh sửa, worker nhận tín hiệu micro lúc 13:49:12 giờ Việt Nam nhưng đến
13:49:43 dịch vụ nhận dạng mới bắt đầu trả chữ; chưa nhận đủ câu trước khi
phiên thử đóng. Log các phiên trước có lỗi Soniox kết nối timeout/reconnect.

Thay đổi:

- Dùng `stt-rt-v5` thay `stt-rt-v4`, cập nhật `.env` hiện có và mặc định mẫu.
- Nhận micro 16 kHz mono, khung 20 ms, đúng định dạng STT, tránh bước resample
  từ mặc định RoomIO 24 kHz/50 ms.
- Log nhận khung âm thanh đầu, tín hiệu đầu và kết quả nhận dạng cuối. Không
  ghi nội dung nói trong các log mới. Khi đóng node, đóng stream provider cùng.

Lượt thử sau chỉnh sửa nhận đủ câu tiếng Việt sau 9988 ms từ lúc bắt đầu phát
mẫu (gồm cả độ dài mẫu và khoảng silence đầu); nhận đủ câu trả lời của agent
sau 21438 ms. Log SDK ghi độ trễ đầu-cuối của lượt trả lời 5697 ms; không đồng
nhất các mốc này với thời gian STT. Lượt thử dùng TTS làm đầu vào, chưa thay thế
kiểm tra micro vật lý trên trình duyệt của người dùng. Mạng và avatar vẫn có
độ trễ biến động.

## Đồng bộ chữ lên giao diện

Người dùng báo tiếp rằng không thấy chữ. Log phiên thực tế vẫn có các câu đã
nhận dạng và lượt trả lời. Worker bổ sung `user.transcript` trên data channel
`portrait` để gửi cả kết quả tạm và cuối trực tiếp tới giao diện. LiveKit stream
vẫn làm fallback cho worker cũ; khi đã nhận đường trực tiếp, bỏ các bản user
stream đến muộn để chúng không ghi đè chữ mới. Transcript user không đi vào lip
sync của avatar. Giao diện có ô “Anh/chị vừa nói” 13 px, xuống dòng, và xóa câu
cũ khi bắt đầu phiên mới.

Kiểm tra 52 test frontend, TypeScript và build web đều đạt. Kiểm tra Chromium
thật với file âm thanh công khai qua fake microphone đã hiện chữ “Alo, em nghe
à?” và bắt đầu nhận câu trả lời “Dạ,”; đây chỉ xác nhận câu trả lời bắt đầu
stream, không ghi nhận toàn bộ câu trả lời hoàn thành. Giao diện thử không có
thông báo lỗi. 15 test về speech input/provider/ngữ cảnh và ruff đạt. Cần tải
lại trang để trình duyệt nạp bundle frontend mới, không chỉ mở lại phiên.

Kiểm tra tự động xác nhận không đổi khung audio/kết quả cuối, không ghi nội
dung nhận dạng trong log mới, và đóng stream provider khi dừng node. Kiểm tra
truyền LiveKit thật đạt; cần kết nối phiên mới để dùng cấu hình đã nạp.
