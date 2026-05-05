/**
 * Normalize phone number to WhatsApp format (628xxx)
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Handle Indonesian numbers
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8') && cleaned.length >= 10) {
    cleaned = '62' + cleaned;
  } else if (cleaned.startsWith('+62')) {
    cleaned = cleaned.substring(1);
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  // Indonesian phone: 62 + 8-13 digits
  return /^62\d{8,13}$/.test(normalized);
}

/**
 * Format phone for WhatsApp JID
 */
export function toWhatsAppJid(phone: string): string {
  const normalized = normalizePhone(phone);
  return `${normalized}@c.us`;
}
