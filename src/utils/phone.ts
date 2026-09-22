/**
 * Normalize phone number to standard international format without '+' or extra symbols.
 * Default converts Indonesian numbers (08xxx / 8xxx / +628xxx) to 628xxx.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  // Remove spaces, hyphens, plus, parenthesis, and non-digits
  let cleaned = phone.toString().replace(/\D/g, '');

  // Handle Indonesian numbers
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8') && cleaned.length >= 9 && cleaned.length <= 13) {
    cleaned = '62' + cleaned;
  } else if (cleaned.startsWith('0062')) {
    cleaned = cleaned.substring(2);
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  // International format: 7 to 15 digits (Indonesian 628xx is typically 10-14 digits)
  return /^\d{8,15}$/.test(normalized);
}

/**
 * Format phone for WhatsApp JID
 */
export function toWhatsAppJid(phone: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();

  // If already formatted with whatsapp domain, return as is
  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@g.us') || trimmed.endsWith('@lid') || trimmed.endsWith('@s.whatsapp.net')) {
    return trimmed;
  }

  // Detect group ID (often contains a dash and no @ yet, or starts with 120363)
  if (trimmed.includes('-') && !trimmed.includes('@')) {
    return `${trimmed}@g.us`;
  }

  const normalized = normalizePhone(trimmed);
  return `${normalized}@c.us`;
}

