# Nguồn và phạm vi tích hợp

- Luồng STT/LLM/TTS và cấu hình provider được viết lại có tham khảo project cục bộ
  `D:\Code\chatbothcc\kiosk-voice-agent`, đặc biệt `agent/providers.py`,
  `agent/main.py` và `LOCAL_STT_LLM_TTS_CONTRACT.md`.
- Không sao chép .env, API key, dữ liệu công dân, forms.json, catalog, OCR,
  lịch sử biểu mẫu hoặc phần admin từ project đó.
- Bộ ảnh và renderer được lấy từ project người dùng đã duyệt
  `Portrait Motion Studio V13`: ảnh gốc, atlas môi 11 mức, blink fields,
  character matte và rigid head motion. Các file trong `web/public/avatar/`
  được giữ trong repo để frontend chạy độc lập.
- Atlas khẩu hình đã chuẩn bị bằng LivePortrait tại thời điểm dựng demo.
  Model, checkpoint và công cụ neural không được nhúng vào repo runtime.
  Nguồn upstream: https://github.com/KlingAIResearch/LivePortrait .
  Kiểm tra điều khoản model/ảnh và sự đồng ý sử dụng hình ảnh trước khi phân phối
  ra ngoài phạm vi dự án. Repo không tự cấp quyền cho tài sản của bên thứ ba.
- LiveKit dependencies dùng theo giấy phép upstream và package lock.
  Soniox và LLM là các dịch vụ cần tài khoản riêng; repo không kèm quyền sử dụng API.

Tài liệu đối chiếu API khi triển khai:

- https://docs.livekit.io/agents/models/stt/soniox/
- https://docs.livekit.io/agents/models/tts/soniox/
- https://docs.livekit.io/agents/multimodality/text/
- https://docs.livekit.io/agents/server/agent-dispatch/

Phiên bản đã khóa: LiveKit Agents và plugin 1.8.8, livekit-client 2.23.0.
