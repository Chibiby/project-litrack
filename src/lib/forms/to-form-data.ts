/**
 * Build FormData from a plain object for server actions that still expect FormData.
 * Arrays become repeated keys with `[]` suffix (e.g. `tags[]`).
 * Booleans become `"true"` / `"false"`. Undefined/null values are skipped.
 */
export function toFormData(
  values: Record<string, unknown>,
  extras?: Record<string, string>
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    appendValue(fd, key, value);
  }
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      fd.set(key, value);
    }
  }
  return fd;
}

function appendValue(fd: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (value instanceof File) {
    fd.append(key, value);
    return;
  }
  if (Array.isArray(value)) {
    const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
    for (const item of value) {
      if (item === undefined || item === null) continue;
      fd.append(arrayKey, String(item));
    }
    return;
  }
  if (typeof value === "boolean") {
    fd.set(key, value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return;
    fd.set(key, String(value));
    return;
  }
  fd.set(key, String(value));
}
