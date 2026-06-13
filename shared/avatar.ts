// Deterministic avatar color from a seed (address). Used by both client + server.
export function avatarSeedToColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = (h & 0xffffff).toString(16).padStart(6, "0");
  return `#${hex}`;
}
