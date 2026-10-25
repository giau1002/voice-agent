import { describe, expect, it } from 'vitest';
import { emptyForm, formProblem, parseFormState, validBirthDate } from './demo-form';

describe('birth registration', () => {
  it('requires child, mother and declarant details while allowing optional fields to stay blank', () => {
    const state = emptyForm();
    expect(formProblem(state.fields)).toContain('8 mục chính');
    Object.assign(state.fields, { child_name: 'Trần Minh An', child_birth_date: '2025-01-10', child_sex: 'Nam',
      child_birth_place: 'Bệnh viện Mẫu', mother_name: 'Nguyễn An', full_name: 'Nguyễn An', relationship: 'Mẹ', address: '123 Đường Mẫu' });
    expect(formProblem(state.fields)).toBe('');
    expect(state.fields.father_name).toBe('');
    expect(state.fields.child_nationality).toBe('');
  });

  it('rejects invalid calendar dates and future dates', () => {
    expect(validBirthDate('2025-02-30')).toBe(false);
    expect(validBirthDate('9999-01-01')).toBe(false);
    expect(validBirthDate('2024-02-29')).toBe(true);
    expect(validBirthDate('2025-02-29')).toBe(false);
  });

  it('accepts complete transport fields and rejects an old support-only payload', () => {
    expect(parseFormState(emptyForm())).not.toBeNull();
    expect(parseFormState({ ...emptyForm(), fields: { full_name: 'An', phone: '', address: '', request: '' } })).toBeNull();
  });
});
