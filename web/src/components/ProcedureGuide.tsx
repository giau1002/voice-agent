import { ChevronRight, ContactRound, FileText, FolderOpen, Lightbulb, MessageCircle, QrCode, Sparkles } from 'lucide-react';
import { SearchReference } from './SearchReference';
import type { WebLookup } from '../lib/web-search';

const topics = [
  { title: 'Đăng ký khai sinh', icon: FileText, note: 'Hướng dẫn hồ sơ, các bước và nơi tiếp nhận', tone: 'blue' },
  { title: 'Cấp giấy chứng sinh', icon: ContactRound, note: 'Hướng dẫn thông tin và giấy tờ cần chuẩn bị', tone: 'teal' },
  { title: 'Chứng thực bản sao', icon: FolderOpen, note: 'Hướng dẫn giấy tờ và quy trình thực hiện', tone: 'amber' },
  { title: 'Đăng ký hỗ trợ', icon: MessageCircle, note: 'Hướng dẫn sử dụng kiosk và biểu mẫu', tone: 'violet' },
];

interface Props {
  answer: string; topic: string; lookup: WebLookup | null;
  disabled: boolean; connected: boolean;
  onTopic: (topic: string) => void; onOpenForm: () => void;
}

export function ProcedureGuide(props: Props) {
  return <section className="procedure-panel" aria-labelledby="procedure-title">
    <header className="procedure-header">
      <div className="procedure-hero-copy"><span className="procedure-eyebrow">CHÀO MỪNG BẠN ĐẾN VỚI</span><h1 id="procedure-title" aria-label="Trung tâm Phục vụ Hành chính công">Trung tâm Phục vụ<br /><span>Hành chính công</span></h1><p>Chúng tôi hỗ trợ tra cứu và hướng dẫn các thủ tục hành chính công một cách nhanh chóng, thuận tiện.</p></div>
      <div className="procedure-hero-art" aria-hidden="true"><img src="/illustrations/public-service-center.png" alt="" /></div>
    </header>
    <div className="procedure-content">
      <span className="sr-only">{props.connected ? 'Chọn một thủ tục hoặc nói trực tiếp với trợ lý.' : 'Bấm Bắt đầu trò chuyện để chọn thủ tục hoặc yêu cầu hướng dẫn bằng giọng nói.'}</span>
      <div className="procedure-topics" aria-label="Chọn nội dung hướng dẫn">{topics.map(({ title, icon: Icon, note, tone }, index) => <button key={title} className={'topic-' + tone} disabled={props.disabled} aria-label={title} aria-describedby={'procedure-topic-note-' + index} aria-pressed={props.topic === title} onClick={() => props.onTopic(title)}>
        <span className="procedure-topic-icon" aria-hidden="true"><Icon size={27} strokeWidth={1.8} /></span><span className="procedure-topic-copy"><strong>{title}</strong><small id={'procedure-topic-note-' + index}>{note}</small></span><ChevronRight className="procedure-topic-action" size={20} aria-hidden="true" />
      </button>)}</div>
      {!props.answer ? <div className="procedure-instructions"><div className="procedure-instructions-heading"><span><Lightbulb size={20} /></span><h2>Hướng dẫn sử dụng nhanh</h2></div><ol>
        <li><span className="procedure-step-number">1</span><div><strong>Chọn thủ tục</strong><p>Chọn dịch vụ cần thực hiện ở phía trên.</p></div><ChevronRight size={18} aria-hidden="true" /></li>
        <li><span className="procedure-step-number">2</span><div><strong>Nghe hướng dẫn</strong><p>Làm theo hướng dẫn về hồ sơ, các bước và nơi tiếp nhận.</p></div><ChevronRight size={18} aria-hidden="true" /></li>
        <li><span className="procedure-step-number">3</span><div><strong>Nhận mẫu biểu</strong><p>Nói “Mở tờ khai khai sinh giúp tôi” để điền bản.</p></div></li>
      </ol></div>
        : <section className="procedure-answer" aria-labelledby="current-guide-title"><div><Sparkles size={16} /><h2 id="current-guide-title">{props.topic || 'Trợ lý đang hướng dẫn'}</h2></div><p>{props.answer}</p></section>}
      {props.lookup && <SearchReference lookup={props.lookup} />}
    </div>
    <footer className="procedure-footer"><span className="procedure-footer-icon" aria-hidden="true"><QrCode size={24} /></span><div><strong>Bạn cần thông tin khác?</strong><p>Nói “mở biểu mẫu” hoặc chọn thủ tục bên trên để được hướng dẫn chi tiết.</p></div><button aria-label="Mở biểu mẫu" title="Mở biểu mẫu" onClick={props.onOpenForm}><span>Mở biểu mẫu</span><ChevronRight size={16} /></button></footer>
  </section>;
}
