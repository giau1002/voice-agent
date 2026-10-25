export const formLabels = {
  child_name: 'Họ tên trẻ',
  child_birth_date: 'Ngày sinh của trẻ',
  child_sex: 'Giới tính của trẻ',
  child_birth_place: 'Nơi sinh của trẻ',
  child_ethnicity: 'Dân tộc của trẻ',
  child_nationality: 'Quốc tịch của trẻ',
  child_hometown: 'Quê quán của trẻ',
  mother_name: 'Họ tên mẹ',
  mother_birth_date: 'Ngày sinh của mẹ',
  mother_nationality: 'Quốc tịch của mẹ',
  mother_address: 'Nơi cư trú của mẹ',
  father_name: 'Họ tên cha',
  father_birth_date: 'Ngày sinh của cha',
  father_nationality: 'Quốc tịch của cha',
  father_address: 'Nơi cư trú của cha',
  full_name: 'Họ tên người đi đăng ký',
  relationship: 'Quan hệ với trẻ',
  identity_number: 'Giấy tờ tùy thân người đi đăng ký',
  address: 'Địa chỉ người đi đăng ký',
  phone: 'Số điện thoại liên hệ',
  registration_office: 'Nơi đăng ký dự kiến',
} as const;
export type FormKey = keyof typeof formLabels;
export type FormFields = Record<FormKey, string>;
export const requiredFields: readonly FormKey[] = [
  'child_name', 'child_birth_date', 'child_sex', 'child_birth_place',
  'mother_name', 'full_name', 'relationship', 'address',
];
export const formGroups: { title: string; note: string; keys: FormKey[] }[] = [
  { title: 'Thông tin trẻ được đăng ký khai sinh', note: 'Điền đúng thông tin của trẻ, có thể lấy từ giấy chứng sinh.',
    keys: ['child_name', 'child_birth_date', 'child_sex', 'child_birth_place', 'child_ethnicity', 'child_nationality', 'child_hometown'] },
  { title: 'Thông tin cha, mẹ', note: 'Có thể để trống thông tin cha hoặc các mục bổ sung khi chưa có.',
    keys: ['mother_name', 'mother_birth_date', 'mother_nationality', 'mother_address', 'father_name', 'father_birth_date', 'father_nationality', 'father_address'] },
  { title: 'Người đi đăng ký khai sinh', note: 'Thông tin của người đang thực hiện kê khai cho trẻ.',
    keys: ['full_name', 'relationship', 'identity_number', 'address', 'phone', 'registration_office'] },
];
export interface DemoFormState {
  visible: boolean; active: boolean; confirmed: boolean; revision: number;
  fields: FormFields; sources: Partial<Record<FormKey, 'ocr' | 'user'>>;
}
export const emptyForm = (): DemoFormState => ({
  visible: false, active: false, confirmed: false, revision: 0,
  fields: Object.fromEntries(Object.keys(formLabels).map(key => [key, ''])) as FormFields, sources: {},
});
export const fieldLimits: Record<FormKey, number> = {
  child_name: 120, child_birth_date: 30, child_sex: 30, child_birth_place: 300,
  child_ethnicity: 60, child_nationality: 80, child_hometown: 300,
  mother_name: 120, mother_birth_date: 30, mother_nationality: 80, mother_address: 300,
  father_name: 120, father_birth_date: 30, father_nationality: 80, father_address: 300,
  full_name: 120, relationship: 80, identity_number: 40, address: 300, phone: 30, registration_office: 300,
};
export function todayInVietnam(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function validBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayInVietnam()) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
export function formProblem(fields: FormFields): string {
  for (const key of Object.keys(formLabels) as FormKey[]) {
    const value = fields[key];
    if (value.length > fieldLimits[key]) return formLabels[key] + ' quá dài.';
    if (value && key.endsWith('_birth_date') && !validBirthDate(value)) return formLabels[key] + ' chưa hợp lệ hoặc ở tương lai.';
  }
  if (fields.phone && !/^\+?[0-9]{8,15}$/.test(fields.phone.replace(/[\s().-]/g, ''))) return 'Số điện thoại cần từ 8 đến 15 chữ số.';
  if (fields.child_sex && !['Nam', 'Nữ', 'Chưa xác định'].includes(fields.child_sex)) return 'Kiểm tra lại giới tính của trẻ.';
  const missing = requiredFields.filter(key => !fields[key].trim());
  if (missing.length) return 'Tờ khai còn thiếu ' + missing.length + ' mục chính.';
  return '';
}
export function parseFormState(value: unknown): DemoFormState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as DemoFormState;
  if (typeof state.visible !== 'boolean' || typeof state.active !== 'boolean' || typeof state.confirmed !== 'boolean'
    || !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.fields || !state.sources) return null;
  for (const key of Object.keys(formLabels) as FormKey[]) {
    if (typeof state.fields[key] !== 'string' || state.fields[key].length > fieldLimits[key]) return null;
    if (state.sources[key] !== undefined && !['ocr', 'user'].includes(state.sources[key]!)) return null;
  }
  return state;
}
