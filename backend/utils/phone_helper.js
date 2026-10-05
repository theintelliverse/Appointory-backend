/**
 * Normalizes and validates Indian mobile phone numbers.
 * Strips non-digits, country code (+91/91) if 12 digits, leading 0 if 11 digits.
 * Validates against Indian mobile regex: /^[6-9]\d{9}$/
 * 
 * @param {string} raw - raw phone string input
 * @returns {{ isValid: boolean, normalized: string|null, error?: string }}
 */
function normalizeIndianPhone(raw) {
  if (!raw) return { isValid: false, normalized: null, error: 'Phone number is required' };

  let digits = String(raw).replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  const isValid = /^[6-9]\d{9}$/.test(digits);

  if (!isValid) {
    return {
      isValid: false,
      normalized: digits.length === 10 ? digits : null,
      error: 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9'
    };
  }

  return { isValid: true, normalized: digits };
}

module.exports = { normalizeIndianPhone };
