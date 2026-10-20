import { CalendarDays, ChevronRight, FileText, FolderClosed, MessageSquareMore } from 'lucide-react';

const options = [
  { title: 'Tra cứu hồ sơ', description: 'Tìm cách kiểm tra tình trạng hồ sơ', color: 'blue', icon: FolderClosed,
    question: 'Tôi muốn được hướng dẫn cách tra cứu tình trạng hồ sơ và kênh tra cứu chính thức.' },
  { title: 'Hướng dẫn thủ tục', description: 'Tư vấn quy trình, thành phần hồ sơ', color: 'green', icon: FileText,
    question: 'Tôi cần được hướng dẫn thực hiện một thủ tục hành chính.' },
  { title: 'Đặt lịch hỗ trợ', description: 'Hướng dẫn đăng ký lịch hẹn', color: 'purple', icon: CalendarDays,
    question: 'Tôi muốn tìm hiểu cách đặt lịch hỗ trợ và kênh liên hệ chính thức của trung tâm.' },
  { title: 'Hỏi về hồ sơ', description: 'Các vấn đề khác liên quan', color: 'orange', icon: MessageSquareMore,
    question: 'Tôi có thắc mắc về hồ sơ cần được giải đáp.' },
];

export function SupportOptions({ onSelect, disabled }: { onSelect: (text: string) => void; disabled: boolean }) {
  return <section className="support-options" aria-labelledby="support-options-title">
    <h3 id="support-options-title">Anh/chị có thể chọn nội dung cần hỗ trợ:</h3>
    <div className="support-grid">{options.map(({ title, description, color, icon: Icon, question }) =>
      <button key={title} className={`support-option ${color}`} onClick={() => onSelect(question)} disabled={disabled}>
        <span className="support-option-icon"><Icon size={25} strokeWidth={1.8} /></span>
        <span className="support-option-copy"><strong>{title}</strong><span>{description}</span></span>
        <ChevronRight size={18} className="support-option-arrow" />
      </button>,
    )}</div>
  </section>;
}
