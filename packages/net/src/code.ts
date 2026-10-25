// Invite codes (specification §8, Joining): the host's peer id, short enough to read out or type on a phone.

/** Lowercase letters and digits that cannot be mistaken for one another: no 0 o 1 l i. */
export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 6;

/** A random invite code: 31⁶, about 900 million codes. */
export function inviteCode(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  let code = "";
  // Rejection sampling keeps every symbol equally likely: 248 is the largest multiple of 31 under 256.
  while (code.length < CODE_LENGTH) {
    for (const byte of random(new Uint8Array(CODE_LENGTH))) {
      if (byte < 248 && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code;
}

/** A code as typed or pasted: trimmed and lowercased; a whole join link gives its code. Null when it is no code. */
export function readCode(input: string): string | null {
  const text = input.trim();
  const fromLink = /#join=([\w-]+)/.exec(text)?.[1];
  const code = (fromLink ?? text).toLowerCase();
  return /^[\w-]{1,64}$/.test(code) ? code : null;
}
