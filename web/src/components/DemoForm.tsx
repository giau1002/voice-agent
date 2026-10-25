import { Check, ChevronRight, FileCheck2, FileText, FileUp, LoaderCircle, MessageCircle, Phone, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { fieldLimits, formGroups, formLabels, formProblem, requiredFields, todayInVietnam, type DemoFormState, type FormKey } from '../lib/demo-form';

interface Props {
  state: DemoFormState; online: boolean; connecting: boolean; connectionDisabled: boolean;
  busy: boolean; ocrBusy: boolean;
  filename: string; ocrText: string; warnings: string[];
  onChange: (key: FormKey, value: string) => void;
  onUpload: () => void; onStart: () => void; onStop: () => void;
  onConnect: () => void; onConfirm: () => void; onClose: () => void;
}

export function DemoForm(props: Props) {
  const { state, busy, ocrBusy } = props;
  const count = requiredFields.filter(key => state.fields[key].trim()).length;
  const next = requiredFields.find(key => !state.fields[key].trim());
  const nextField = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    if (state.active) nextField.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [state.active, next]);
  const stage = state.confirmed ? 2 : props.filename || count ? 1 : 0;
  const problem = formProblem(state.fields);
  const locked = busy || ocrBusy || state.active;

  return <section className="demo-form-panel" aria-labelledby="demo-form-title" aria-busy={busy || ocrBusy}>
    <header className="demo-form-header">
      <div className="demo-form-heading">
        <div className="demo-form-title"><span className="form-title-icon"><FileText size={23} /></span><div>
          <h2 id="demo-form-title">Tờ khai đăng ký khai sinh</h2>
          <p>Chưa nộp hồ sơ</p>
        </div></div>
        <button className="icon-button" aria-label="Đóng biểu mẫu" title="Trở lại hướng dẫn thủ tục" onClick={props.onClose} disabled={busy || ocrBusy}><X size={18} /></button>
      </div>
      <ol className="form-steps" aria-label="Tiến độ điền phiếu">
        {['Tài liệu', 'Kiểm tra & bổ sung', 'Hoàn tất'].map((label, index) => <li key={label} className={index < stage ? 'done' : index === stage ? 'current' : ''} aria-current={index === stage ? 'step' : undefined}>
          <span className="form-step-number">{index < stage ? <Check size={13} /> : index + 1}</span><span>{label}</span>
          {index < 2 && <ChevronRight size={14} className="form-step-arrow" aria-hidden="true" />}
        </li>)}
      </ol>
    </header>

    <div className="demo-form-content">
      <section className="form-document" aria-label="Tài liệu điền trước">
        {props.filename && !ocrBusy ? <div className="form-document-ready">
          <span className="document-check"><FileCheck2 size={23} /></span>
          <div><strong>{props.filename}</strong><span>Đã đọc tài liệu · Kiểm tra thông tin bên dưới</span></div>
          <button type="button" className="form-text-button" disabled={busy || ocrBusy} onClick={props.onUpload}>Thay tài liệu</button>
        </div> : <button type="button" className="form-upload" onClick={props.onUpload} disabled={busy || ocrBusy}>
          <span className="document-upload-icon">{ocrBusy ? <LoaderCircle size={23} className="spin" /> : <FileUp size={23} />}</span>
          <span className="form-upload-copy"><strong>{ocrBusy ? 'Đang đọc tài liệu…' : 'Tải PDF hoặc hình ảnh'}</strong><small>{ocrBusy ? 'Thông tin nhận được sẽ xuất hiện trên phiếu' : 'JPG, PNG, WebP, PDF · tối đa 8 MB'}</small></span>
          {!ocrBusy && <span className="form-upload-cta">Chọn tệp</span>}
        </button>}
        <p className="form-document-note">OCR bằng Gemini. Có thể nhập trực tiếp nếu chưa có tài liệu.</p>
      </section>

      {props.warnings.length > 0 && <ul className="ocr-warnings">{props.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}

      <div className="form-section-heading"><div><h3>Nội dung tờ khai khai sinh</h3><p>Dấu * là mục chính cần điền. Các mục bổ sung có thể để trống.</p></div><span className={`form-completion ${count === requiredFields.length ? 'complete' : ''}`}>{count}/{requiredFields.length} mục chính</span></div>
      {formGroups.map((group, index) => <fieldset className="birth-form-group" key={group.title}>
        <legend><span>{String(index + 1).padStart(2, '0')}</span>{group.title}</legend><p className="birth-group-note">{group.note}</p>
        <div className="demo-fields">{group.keys.map(key => {
          const required = requiredFields.includes(key);
          const isAddress = key.includes('address') || key === 'child_birth_place' || key === 'child_hometown';
          const isDate = key.endsWith('_birth_date');
          return <label ref={state.active && next === key ? nextField : null} className={`demo-field ${isAddress ? 'field-wide' : ''} ${state.active && next === key ? 'field-current' : ''}`} key={key}>
            <span>{formLabels[key]}{required && <b className="birth-required" aria-hidden="true">*</b>}<small className={state.fields[key] ? 'has-value' : ''}>{state.fields[key] ? state.sources[key] === 'ocr' ? 'Từ tài liệu' : 'Đã điền' : required ? 'Chưa điền' : 'Bổ sung'}</small></span>
            {key === 'child_sex' ? <select value={state.fields[key]} disabled={locked} aria-required={required} onChange={event => props.onChange(key, event.target.value)}><option value="">Chọn giới tính</option><option>Nam</option><option>Nữ</option><option>Chưa xác định</option></select>
              : isAddress ? <textarea value={state.fields[key]} maxLength={fieldLimits[key]} rows={2} disabled={locked} aria-required={required} onChange={event => props.onChange(key, event.target.value)} placeholder={'Nhập ' + formLabels[key].toLocaleLowerCase('vi')} />
              : <input type={isDate ? 'date' : key === 'phone' ? 'tel' : 'text'} max={isDate ? todayInVietnam() : undefined} autoComplete="off" value={state.fields[key]} maxLength={fieldLimits[key]} disabled={locked} aria-required={required} onChange={event => props.onChange(key, event.target.value)} placeholder={key === 'relationship' ? 'Ví dụ: mẹ, cha, ông, bà…' : 'Nhập ' + formLabels[key].toLocaleLowerCase('vi')} />}
          </label>;
        })}</div>
      </fieldset>)}

      {props.ocrText && <details className="ocr-preview"><summary><FileText size={14} /> Đối chiếu văn bản từ tài liệu</summary><pre>{props.ocrText}</pre></details>}
    </div>

    <footer className="demo-form-footer">
      <div className={`form-next ${state.confirmed ? 'confirmed' : ''}`}>
        {state.confirmed ? <Check size={18} /> : <MessageCircle size={18} />}
        <p role="status">{state.confirmed ? 'Đã xác nhận thông tin tờ khai đăng ký khai sinh. Chưa gửi đến cơ quan nào.'
          : state.active && next ? `Anh/chị nói ${formLabels[next].toLocaleLowerCase('vi')} để trợ lý điền, hoặc tải tài liệu để lấy thông tin.`
          : next ? `Còn ${requiredFields.length - count} mục chính cần bổ sung. Nhập trực tiếp hoặc nhờ trợ lý hướng dẫn.`
          : problem || 'Các mục chính đã đủ. Anh/chị kiểm tra tờ khai trước khi xác nhận; có thể bổ sung thêm thông tin cha mẹ.'}</p>
      </div>
      <div className="demo-form-actions">
        <span className="form-draft-note">Bản nháp chỉ giữ trong phiên này</span>
        <div className="form-action-buttons">
          {state.active
            ? <button type="button" className="form-secondary" onClick={props.onStop} disabled={busy}>Dừng hỏi đáp để chỉnh sửa</button>
            : props.online
              ? <button type="button" className="form-secondary" onClick={props.onStart} disabled={busy || ocrBusy || state.confirmed}><MessageCircle size={16} /> Hỏi đáp điền form</button>
              : <button type="button" className="form-secondary" onClick={props.onConnect} disabled={busy || props.connecting || props.connectionDisabled}>
                {props.connecting ? <LoaderCircle size={16} className="spin" /> : <Phone size={16} />} {props.connecting ? 'Đang kết nối…' : 'Kết nối trợ lý'}
              </button>}
          <button type="button" className="form-confirm" onClick={props.onConfirm} disabled={busy || ocrBusy || !!problem || state.confirmed}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} {state.confirmed ? 'Đã xác nhận' : 'Xác nhận tờ khai'}
          </button>
        </div>
      </div>
    </footer>
  </section>;
}
