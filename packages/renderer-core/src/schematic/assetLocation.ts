const DEFAULT_DOMAIN = "game";

export function normalizeAssetLocation(
  rawCode: string,
  defaultDomain = DEFAULT_DOMAIN,
): string {
  const code = rawCode.trim();
  if (code.length === 0) {
    throw new Error("Asset location cannot be empty.");
  }

  const separatorIndex = code.indexOf(":");
  if (separatorIndex < 0) {
    return defaultDomain + ":" + code;
  }

  const domain = code.slice(0, separatorIndex).trim();
  const path = code.slice(separatorIndex + 1).trim();
  if (domain.length === 0 || path.length === 0) {
    throw new Error("Invalid asset location: " + rawCode);
  }

  return domain + ":" + path;
}
