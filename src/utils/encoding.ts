/**
 * Encode a UTF-8 string to base64, safe for any Unicode characters.
 * Unlike btoa(), this handles emoji, CJK, accented chars, etc.
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary);
}
