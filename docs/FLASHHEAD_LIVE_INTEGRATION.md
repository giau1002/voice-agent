# FlashHead LiveKit integration — 22/10/2026

## Phần đã code

- `deploy/avatar-flashhead/service.py`: model giữ trên GPU, API riêng có token,
  một lease độc quyền. Phiên mới reset cache; lease mất liên lạc có thể được thu
  hồi sau 90 giây. Không lưu audio/video của hội thoại ra đĩa.
- `voice_agent/avatar.py`: nhận PCM từ AgentSession, giới hạn hàng đợi, gửi chunk
  lên renderer, giải mã JPEG và publish audio/video cùng stream vào LiveKit.
  TTS gốc không được RoomIO publish riêng trong chế độ FlashHead.
- Luồng chờ sinh hình từ silence. Khi ngắt lời, xóa queue tiếng/hình và tăng epoch;
  bỏ kết quả GPU cũ. CUDA đang chạy được hoàn thành trong lock trước khi xử lý
  lượt mới để không gây truy cập model song song.
- UI nhận `avatar-video` từ agent và khôi phục vùng đầu–vai về đúng tọa độ trên
  ảnh gốc 560×700, với viền alpha mềm. Khung trước/sau kết nối dùng cùng cover và
  căn ảnh, tránh phóng to mặt hoặc viền trống khi chuyển sang video vuông. Thân
  ngoài vùng crop vẫn là ảnh tĩnh. Khi ngắt kết nối, bỏ track và trở về ảnh 2D.
  Các cài đặt miệng 2D được ẩn ở chế độ FlashHead.
- Lỗi renderer sẽ báo lỗi và đóng phiên; phiên thứ hai nhận báo bận.

## Kiểm tra ở máy phát triển

Đã kiểm tra HTTP thật với renderer giả lập: token, lease độc quyền, PCM đầy đủ,
JPEG, giới hạn packet và hủy request không nhả GPU lock sớm. Đã kiểm tra audio
chờ video, câu ngắn, bỏ kết quả sau ngắt lời, backpressure và renderer timeout.

Đã chạy LiveKit self-hosted thật trên cổng riêng 17880: AgentSession nhận audio
24 kHz giả lập và resample sang sink 16 kHz; phòng người dùng nhận được audio có
tín hiệu và video 512×512. SDK hoàn tất playback với đúng 0,96 giây audio.
Không gọi LLM/STT/TTS trả phí trong kiểm thử này. Web build và Vitest đã qua.

## Cập nhật đo và sửa giật qua AnyDesk

Người dùng đã cấu hình server GPU, Forward Tunnel AnyDesk và `.env` ở chế độ
FlashHead. API/worker và LiveKit đang chạy tại máy chatbot; renderer đã trả health
ready và xuất được hình/tiếng qua tunnel. Không đưa token vào tài liệu/báo cáo.

Mỗi chunk JPEG có khoảng 1,7 MiB. Khi chờ dựng → tải → giải mã nối tiếp, mười
request thử mất 1,12–1,58 giây/chunk sau đoạn đầu 3,62 giây, chậm hơn thời lượng
phát 0,96 giây. Đây là nút thắt của luồng đo thực tế, không phải suy đoán của LLM.

Đã sửa ở worker, tương thích renderer GPU đang chạy:

- Xếp tối đa hai request. Gửi request tiếp sau header của request trước để giữ
  thứ tự trạng thái model, đồng thời chồng phần dựng với phần tải body JPEG.
  Phép thử 12 chunk cho khoảng cách kết quả mới ổn định 0,52–0,73 giây sau giai
  đoạn đầu. Không nhầm khoảng cách kết quả với thời gian riêng của mỗi request.
- Tách cấp tiếng khỏi vòng vẽ từng khung. Nguồn audio native đệm 240 ms, cấp khối
  20 ms; video queue năm khung chạy 25 FPS. Có đệm bắt đầu 180 ms, vẫn giữ giới hạn
  bộ nhớ và bỏ dữ liệu cũ khi ngắt lời.
- Log `Avatar playout summary` ghi số lần thiếu khung ở bộ phát và thời gian tải;
  không log PCM, nội dung hội thoại hoặc khóa dịch vụ.

Phép thử sau sửa dùng đúng GPU và tunnel hiện tại, publish/nhận media qua LiveKit
thật với WAV tiếng Việt đã có: phát đủ 6,495375 giây, nhận 181 khung video và audio
có tín hiệu, không ghi nhận thiếu khung ở bộ phát; đầu đoạn tiếng kế tiếp còn
226–245 ms audio trong hàng đợi. Tổng wall 9,238 giây gồm chuẩn bị/phát; không
phải độ trễ trả lời của chatbot. Báo cáo máy:
[flashhead-anydesk-pacing-20261022.json](benchmarks/flashhead-anydesk-pacing-20261022.json).

Kiểm thử thêm khóa thứ tự header nhưng tải body đồng thời, giữ native audio queue
qua ba chunk khi vẽ bận, ngắt lời và timeout đều qua (9 test, một test LiveKit
opt-in được bỏ qua trong lượt unit). Đã bổ sung thêm kiểm tra ngắt lời khi tiếng
còn nằm sau đoạn idle trong native queue (tổng 10 test unit). Phép thử GPU nêu trên
chạy riêng trên server thật.

## Rút ngắn thời gian chờ lời chào

Worker chuẩn bị âm thanh của `AGENT_GREETING` một lần trước khi nhận job
(`start`/`dev`), rồi lưu WAV ở `.cache/greetings/`. Cache chỉ chứa câu chào cố định
công khai; không lưu câu hỏi, câu trả lời hoặc giọng người dùng. Khóa cache tính
từ nguyên văn lời chào, model, voice, language, speed và sample rate. Đổi cấu hình
thì tạo bản mới; file thiếu/hỏng hoặc prewarm lỗi thì dùng TTS trực tiếp như trước.
Cache được loại khỏi Git và Docker build context.

Khi có lời chào, bộ phát chờ PCM đầu tiên thay vì dựng/xếp trước các chunk im
lặng. GPU vẫn sinh hình mới từ âm thanh ở mỗi phiên. Sau lời chào, chuyển động
nghỉ và các câu trả lời tiếp tục dùng đường live hiện có. Soniox mở kết nối sớm
trong lúc chuẩn bị track GPU; việc nạp Silero được chuyển ra khỏi event loop.

Một lần đo sau sửa qua đúng tunnel AnyDesk và GPU đang chạy: từ yêu cầu tạo phiên
API tới tiếng chào có tín hiệu ở bộ nhận native LiveKit là **2,618 giây**; thiết lập
session phía worker 628 ms, không có thiếu khung ở bộ phát. Tạo cache lời chào
2,826 giây âm thanh mất 3,884 giây nhưng chỉ xảy ra lúc chuẩn bị, ngoài đường bấm
Kết nối. Đây không phải số đo browser/loa hoặc cam kết độ trễ cho mọi lần gọi.
Lần thử trước sửa gặp GPU đang có phiên khác nên không có cặp benchmark trước–sau.
Chi tiết: [flashhead-connect-20261022.json](benchmarks/flashhead-connect-20261022.json).

Log `Voice session ready` và `Avatar first speech ready` chỉ ghi thời gian,
không ghi nội dung hội thoại, PCM hoặc khóa dịch vụ. Bản này chỉ cập nhật worker,
không cần đổi weights hay cập nhật lại dịch vụ trên GPU.

## Giới hạn còn lại

Mẫu L40S được duyệt trước đó là benchmark offline. Đường live thêm JPEG và encode
WebRTC nên cần xem lại độ nét, độ trễ và đồng bộ trên trình duyệt. Phép thử native
LiveKit ở trên không thay thế đánh giá tai nghe/loa và browser của người dùng.
Chuyển tư thế khi ngắt lời cần
xem trực tiếp: engine giữ pose mới nhất đã dựng, có thể đi trước pose đang thấy
do prefetch tối đa hai chunk. Chỉ hỗ trợ một phiên GPU; cuối câu pad silence đến cửa sổ
0,96 giây để giữ trạng thái hình liên tục. Chưa tối ưu độ trễ idle → speech và
chưa tuyên bố đạt các mục tiêu 1,5 giây / 80 ms / 250 ms trên browser.

## Bàn giao

`artifacts/avatar-flashhead-live-update.zip` cập nhật **đúng thư mục FlashHead có
`.runtime`** trên L40S, không tải lại weights. [Hướng dẫn deploy](../deploy/avatar-flashhead/LIVE.md)
có lệnh chạy, cấu hình worker và các bước kiểm tra. Bản sửa giật này chỉ cần
worker mới, không cần chép lại weights hay thay dịch vụ GPU đang chạy.

Tài liệu đối chiếu: [LiveKit raw media](https://docs.livekit.io/transport/media/raw-tracks/),
[avatar outputs](https://docs.livekit.io/agents/models/avatar/).
