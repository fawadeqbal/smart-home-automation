/**
 * Phone numbers as people type them ("0300-1234567", "+92 300 1234567", "300 1234567") turned into
 * the international digits WhatsApp wants in a wa.me link ("923001234567"). Numbers without a
 * country code are Pakistani: the company and its customers are there.
 * The API sends these digits to the screens (`whatsapp` fields), so this is the only copy of the rule.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!/^[+0-9 ()./-]{7,24}$/.test(text)) return null;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = `92${digits.slice(1)}`;
  } else if (/^3\d{9}$/.test(digits)) {
    digits = `92${digits}`; // a mobile number typed without the leading 0
  }
  // Pakistani numbers: 92 then 9 or 10 digits (mobiles are 92 3xx xxxxxxx); others: 8 to 15 digits in all
  if (digits.startsWith('92')) return digits.length === 12 || digits.length === 11 ? digits : null;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** The number to show: "+92 300 1234567" for a Pakistani mobile, else "+<digits>". */
export function displayPhone(digits: string | null): string | null {
  if (!digits) return null;
  const m = /^92(3\d{2})(\d{7})$/.exec(digits);
  return m ? `+92 ${m[1]} ${m[2]}` : `+${digits}`;
}
