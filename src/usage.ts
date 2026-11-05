import type { IrUsage } from "@forebay/host";
import { asInteger, asMap, type JsonObject } from "./json-values.js";

const WIRE_FIELDS: ReadonlyArray<readonly [keyof IrUsage, string]> = [
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cacheCreationInputTokens", "cache_creation_input_tokens"],
  ["cacheReadInputTokens", "cache_read_input_tokens"],
];

export function decodeUsage(wire: unknown): IrUsage | undefined {
  const map = asMap(wire);
  if (map === null) return undefined;
  const usage: IrUsage = {};
  for (const [irField, wireField] of WIRE_FIELDS) {
    const count = asInteger(map[wireField]);
    if (count !== null) usage[irField] = count;
  }
  return usage;
}

export function encodeUsage(usage: IrUsage): JsonObject {
  const wire: JsonObject = {};
  for (const [irField, wireField] of WIRE_FIELDS) {
    const count = usage[irField];
    if (count !== null && count !== undefined) wire[wireField] = count;
  }
  return wire;
}
