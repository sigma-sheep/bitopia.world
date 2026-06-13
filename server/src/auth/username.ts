// Username rules for ENS subname labels: 3–20 chars, lowercase a–z, digits, and
// internal hyphens only (no leading/trailing hyphen). ENS labels normalize to
// lowercase, so callers normalize first, then validate.

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export type UsernameCheck = { ok: true } | { ok: false; error: string };

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/;

export function validateUsername(name: string): UsernameCheck {
  if (name.length < 3 || name.length > 20) {
    return { ok: false, error: "Username must be 3–20 characters." };
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return { ok: false, error: "Username cannot start or end with a hyphen." };
  }
  if (!LABEL_RE.test(name)) {
    return { ok: false, error: "Use only lowercase letters, numbers, and hyphens." };
  }
  return { ok: true };
}
