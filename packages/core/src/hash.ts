export function hashCaseId(secret: string, sourceKey: string): string {
  const input = `${secret}::${sourceKey}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return unsigned.toString(36).toUpperCase().padStart(8, "0");
}
