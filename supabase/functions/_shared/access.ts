// Team codes: the organiser gives each team a random code; the president shares it with the
// members, who enter it when they register.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I

export function newCode(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  const s = Array.from(b, (x) => ALPHABET[x % 32]).join(""); // 256 % 32 = 0: no bias
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = new Uint8Array(14);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => chars[x % chars.length]).join("");
}
