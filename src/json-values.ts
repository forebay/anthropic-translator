export type JsonObject = Record<string, unknown>;

export function asMap(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function asList(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asInteger(value: unknown): number | null {
  return typeof value === "number" ? Math.trunc(value) : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function mapsIn(value: unknown): JsonObject[] | null {
  const list = asList(value);
  if (list === null) return null;
  return list.map(asMap).filter((entry): entry is JsonObject => entry !== null);
}
