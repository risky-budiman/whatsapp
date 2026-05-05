/**
 * Content Variation Engine
 * Generates slight variations of messages to avoid spam detection
 */

interface VariationPool {
  greetings?: string[];
  openers?: string[];
  closers?: string[];
  emojis?: string[];
}

const DEFAULT_GREETINGS = [
  'Halo', 'Hai', 'Assalamualaikum', 'Selamat siang', 'Selamat pagi',
  'Salam', 'Dear', 'Yth.',
];

const DEFAULT_CLOSERS = [
  'Terima kasih 🙏', 'Salam hangat', 'Regards', 'Hormat kami',
  'Terima kasih atas perhatiannya', 'Best regards', 'Salam',
];

const DEFAULT_EMOJIS = ['🙏', '😊', '👋', '✨', '📌', '💡', '📢'];

/**
 * Pick a random item from array
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Apply content variations to a template message
 * Replaces special variation placeholders:
 *   {{random_greeting}} - Random greeting
 *   {{random_closer}}   - Random closing
 *   {{random_emoji}}    - Random emoji
 */
export function applyVariation(
  template: string,
  variationPool?: VariationPool
): string {
  const greetings = variationPool?.greetings || DEFAULT_GREETINGS;
  const closers = variationPool?.closers || DEFAULT_CLOSERS;
  const emojis = variationPool?.emojis || DEFAULT_EMOJIS;

  let result = template;
  result = result.replace(/\{\{random_greeting\}\}/gi, pickRandom(greetings));
  result = result.replace(/\{\{random_closer\}\}/gi, pickRandom(closers));
  result = result.replace(/\{\{random_emoji\}\}/gi, pickRandom(emojis));

  return result;
}

/**
 * Replace template variables with actual values
 * Supports: {nama}, {name}, {phone}, {id_pelanggan}, {amount}, {tanggal}, etc.
 */
export function replaceVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'gi');
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * Full message processing: variables + variation
 */
export function processMessage(
  template: string,
  variables: Record<string, string>,
  variationPool?: VariationPool
): string {
  let message = replaceVariables(template, variables);
  message = applyVariation(message, variationPool);
  return message;
}
