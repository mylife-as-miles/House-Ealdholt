/**
 * Shared content names public files from the site root ("/assets/…"), the form
 * the Quest panel generator reads. The desktop build uses a relative base, so
 * served under a sub-path those paths would miss: resolve them under the base.
 * Absolute URLs (https:, data:, blob:) and relative paths pass through.
 */
export function publicUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${import.meta.env?.BASE_URL ?? "/"}${path.slice(1)}`;
}
