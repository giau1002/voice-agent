import { CalendarDays, ChevronRight, FileText, FolderClosed, MessageSquareMore } from 'lucide-react';

const options = [
  { title: 'Tra cứu hồ sơ', description: 'Tìm cách kiểm tra tình trạng hồ sơ', color: 'blue', icon: FolderClosed,
    question: 'Bạn hướng dẫn mình cách tra cứu tình trạng hồ sơ nhé. Nếu cần tra cứu trực tiếp, hãy chỉ mình kênh chính thức.' },
  { title: 'Hướng dẫn thủ tục', description: 'Tư vấn quy trình, thành phần hồ sơ', color: 'green', icon: FileText,
    question: 'Mình muốn tìm hiểu một thủ tục hành chính. Bạn hỏi mình cần làm thủ tục nào rồi cùng hướng dẫn từng bước nhé.' },
  { title: 'Đặt lịch hỗ trợ', description: 'Hướng dẫn đăng ký lịch hẹn', color: 'purple', icon: CalendarDays,
    question: 'Bạn hướng dẫn mình cách đặt lịch hỗ trợ tại trung tâm nhé. Hãy hỏi mình địa điểm cần đến để tìm kênh liên hệ chính thức.' },
  { title: 'Hỏi về hồ sơ', description: 'Các vấn đề khác liên quan', color: 'orange', icon: MessageSquareMore,
    question: 'Mình có thắc mắc về hồ sơ, bạn cùng mình tìm hiểu nhé.' },
];

export function SupportOptions({ onSelect, disabled }: { onSelect: (text: string) => void; disabled: boolean }) {
  return <section className="support-options" aria-labelledby="support-options-title">
    <h3 id="support-options-title">Bạn có thể chọn nội dung cần hỗ trợ:</h3>
    <div className="support-grid">{options.map(({ title, description, color, icon: Icon, question }) =>
      <button key={title} className={`support-option ${color}`} onClick={() => onSelect(question)} disabled={disabled}>
        <span className="support-option-icon"><Icon size={25} strokeWidth={1.8} /></span>
        <span className="support-option-copy"><strong>{title}</strong><span>{description}</span></span>
        <ChevronRight size={18} className="support-option-arrow" />
      </button>,
    )}</div>
  </section>;
}
