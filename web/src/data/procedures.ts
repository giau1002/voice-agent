export interface Procedure { id: string; title: string; category: string; popular?: boolean }

// Labels from the supplied UI reference. This is an editable topic catalog,
// not a source of legal requirements or a connection to the public-service portal.
export const procedures: Procedure[] = [
  { id: '2.000884', title: 'Thủ tục chứng thực chữ ký trong các giấy tờ, văn bản', category: 'Chứng thực', popular: true },
  { id: '2.000815', title: 'Chứng thực bản sao từ bản chính giấy tờ, văn bản', category: 'Chứng thực' },
  { id: '1.000894', title: 'Thủ tục đăng ký kết hôn', category: 'Hộ tịch' },
  { id: '1.004873', title: 'Thủ tục cấp Giấy xác nhận tình trạng hôn nhân', category: 'Hộ tịch' },
  { id: '2.000635', title: 'Cấp bản sao trích lục hộ tịch, bản sao Giấy khai sinh', category: 'Hộ tịch' },
];

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export function searchProcedures(query: string) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return procedures.filter(item => words.every(word => normalizeSearch(`${item.id} ${item.title} ${item.category}`).includes(word)));
}
