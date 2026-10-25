# Kiểm tra độ trễ ngày 25/10/2026

Các số sau là từng lượt thử trên cấu hình đang chạy, không phải trung bình hay
cam kết độ trễ. Câu thử là dữ liệu công khai, không chứa thông tin công dân.

| Phép đo | Trước | Sau chỉnh luồng/model |
| --- | --- | --- |
| “Tôi muốn làm giấy khai sinh.” | Gọi web ngay | Hỏi địa phương, không gọi web |
| Token/câu gọi công cụ đầu tiên cho câu trên | 921 ms | 839–1046 ms, trả lời trực tiếp |
| Tra cứu lệ phí khai sinh Hà Nội | 6484 ms | 3825–5021 ms, có nguồn |
| Giới hạn chờ mỗi lượt tìm kiếm | 22 giây | 8 giây, không tự retry |

Kiểm tra qua LiveKit với TTS và avatar trước khi sửa hàng đợi avatar: câu hỏi
ban đầu nhận tiếng đầu tiên sau 6982 ms, gồm LLM 1331 ms, câu đầu tới TTS
1559 ms, TTS 884 ms, avatar 4407 ms. Các thành phần có thể chồng lấp, không
cộng cơ học. Câu thử được gửi bằng text vào luồng hội thoại; chưa đo độ trễ
nhận dạng từ micro người dùng.

Đường truyền GPU biến động rõ trong phiên thử: có lần render quá 15 giây và
phiên phải đóng. Một request đơn lẻ khác nhận header HTTP 200 sau 1581 ms,
nhưng cần 8658 ms mới tải hết 1.833.296 byte JPEG cho 0,96 giây video. Health
HTTP 200 mất 187 ms. Health thành công không chứng minh video truyền đủ nhanh.

Theo yêu cầu tập trung tối ưu tìm kiếm, không đổi chế độ hay luồng avatar.
Không quy toàn bộ độ trễ cho tìm kiếm và không coi TTFT là thời điểm nghe tiếng.

So sánh thêm model tìm kiếm với câu hỏi về lệ phí khai sinh Hà Nội: model
`gemini-3.1-flash-lite` trả kết quả có 5 nguồn sau 3223 ms; model cũ
`gemini-2.5-flash` mất 3825–6484 ms ở các lượt trước. Đây là mẫu nhỏ, khác thời
điểm, không phải benchmark đối chứng thống kê. Chọn `gemini-3.1-flash-lite`
làm mặc định cho tìm kiếm và giới hạn phần tổng hợp tối đa 3 câu.
`gemini-2.5-flash-lite` trả 404 trong tài khoản này nên không được chọn.

Kiểm tra cấu hình cuối: model mới trả câu hỏi lệ phí sau 3227 ms với 7 nguồn,
và câu hỏi thời tiết Thành phố Hồ Chí Minh sau 2587 ms với 5 nguồn. Nêu rõ yêu
cầu dùng Google Search trong câu truy vấn. Giữ trần 2048 token thay vì cắt thấp
để tránh mất câu trả lời/grounding; phần tổng hợp vẫn yêu cầu tối đa 3 câu.

Thay đổi khác: giảm thinking bằng tham số phù hợp dòng Gemini, chốt lượt Soniox
mặc định 700 ms, cache tối đa 8 kết quả web thành công/phiên trong 90 giây,
và câu báo đang kiểm tra chạy đồng thời với tìm kiếm. Trạng thái lỗi/hủy không
được cache, không dùng nguồn thiếu căn cứ để trả lời phí hoặc quy định hiện hành.

Kiểm tra timeout hủy request, không retry ngầm; chỉ cache kết quả có nguồn,
cache hết hạn và tách từng phiên; hủy/ngắt lời không bị biến thành câu trả lời
lỗi và không được cache. Bộ backend cuối đạt 86 passed, 6 skipped; sau chỉnh
prompt tìm kiếm, kiểm tra 21 test về tìm kiếm/provider/ngữ cảnh và ruff đều đạt.
