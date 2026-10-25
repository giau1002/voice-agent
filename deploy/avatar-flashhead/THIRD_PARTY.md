# Nguồn và điều kiện sử dụng

Gói không có dịch vụ avatar trả phí, API key, tài khoản hoặc kiểm tra credits.
Mô hình tải trực tiếp trên server; không đóng gói trọng số vào ZIP này.

- [SoulX-FlashHead](https://github.com/Soul-AILab/SoulX-FlashHead), source commit
  `9bc03de06bb0de82cd6bc477804512ae06144bf2`: Apache-2.0. Giữ nguyên LICENSE trong
  source ZIP. Hai thay đổi import được đánh dấu trong file và thực hiện bởi assets.py.
- [Trọng số FlashHead](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B),
  revision `5fbd2e44ba08ab2deb28bd55cff2c15523e51ba5`: model card ghi transformer
  Apache-2.0, **VAE_LTX Open-RAIL-M**. Không đổi nhãn toàn bộ gói thành Apache-2.0.
  Model card được tải và kiểm tra hash cùng trọng số. Khi phân phối lại trọng số,
  cần giữ điều kiện sử dụng riêng của VAE_LTX theo model card.
- [wav2vec2-base-960h](https://huggingface.co/facebook/wav2vec2-base-960h),
  revision `22aad52d435eb6dbaf354bdad9b0da84ce7d6156`: Apache-2.0 theo model card.
- [uv](https://github.com/astral-sh/uv) 0.13.3: MIT/Apache-2.0. Archive bootstrap
  chính thức được kiểm tra SHA-256 trước khi chạy.

Ảnh là tài sản sẵn có do người dùng cung cấp cho dự án. WAV thử đã được tạo ở bước
trước; bộ thử này không phát sinh yêu cầu API Soniox mới. Chỉ bộ dựng avatar mới là
tự chạy ở đây; chatbot hiện có vẫn cấu hình STT/TTS/LLM riêng.
