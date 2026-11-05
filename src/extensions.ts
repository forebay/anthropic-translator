import type { JsonObject } from "./json-values.js";

export type Extensions = Record<string, unknown>;

interface ExtensionOwner {
  extensions?: Extensions | null;
}

const NEUTRAL_KEY_PREFIX = "$";

export function putExtension(owner: ExtensionOwner, key: string, value: unknown): void {
  owner.extensions ??= {};
  owner.extensions[key] = value;
}

export function extensionOf(owner: ExtensionOwner, key: string): unknown {
  return owner.extensions?.[key];
}

export function isExtensionFlagSet(owner: ExtensionOwner, key: string): boolean {
  return extensionOf(owner, key) === true;
}

export function copyWireExtensions(owner: ExtensionOwner, target: JsonObject): void {
  for (const [key, value] of Object.entries(owner.extensions ?? {})) {
    if (!key.startsWith(NEUTRAL_KEY_PREFIX)) target[key] = value;
  }
}

export function putUnconsumedAsExtensions(wire: JsonObject, consumed: ReadonlySet<string>, owner: ExtensionOwner): void {
  for (const [key, value] of Object.entries(wire)) {
    if (!consumed.has(key)) putExtension(owner, key, value);
  }
}
