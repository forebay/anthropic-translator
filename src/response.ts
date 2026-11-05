import type { IrResponse } from "@forebay/host";
import { decodeBlockList, encodeBlockList } from "./blocks.js";
import { copyWireExtensions, extensionOf, putExtension, putUnconsumedAsExtensions } from "./extensions.js";
import { asMap, asString, type JsonObject } from "./json-values.js";
import { stopReasonToIr } from "./stop-reason.js";
import { decodeUsage, encodeUsage } from "./usage.js";

const EXTENSION_STOP_REASON_RAW = "$stopReasonRaw";
const EXTENSION_STOP_SEQUENCE_RAW = "$stopSequenceRaw";
const EXTENSION_TYPE_RAW = "$typeRaw";
const EXTENSION_ROLE_RAW = "$roleRaw";

const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "id", "type", "role", "content", "model", "stop_reason", "stop_sequence", "usage",
]);

export function decodeResponse(body: unknown): IrResponse {
  const root = asMap(body);
  if (root === null) return { id: "", model: "", stopReason: stopReasonToIr(null), content: [] };
  const stopReasonRaw = asString(root.stop_reason);
  const response: IrResponse = {
    id: asString(root.id) ?? "",
    model: asString(root.model) ?? "",
    content: decodeBlockList(root.content) ?? [],
    stopReason: stopReasonToIr(stopReasonRaw),
  };
  const usage = decodeUsage(root.usage);
  if (usage !== undefined) response.usage = usage;
  putExtension(response, EXTENSION_STOP_REASON_RAW, stopReasonRaw);
  putExtension(response, EXTENSION_STOP_SEQUENCE_RAW, root.stop_sequence ?? null);
  putExtension(response, EXTENSION_TYPE_RAW, root.type ?? null);
  putExtension(response, EXTENSION_ROLE_RAW, root.role ?? null);
  putUnconsumedAsExtensions(root, KNOWN_TOP_LEVEL_KEYS, response);
  return response;
}

export function encodeResponse(response: IrResponse): JsonObject {
  const wire: JsonObject = {
    id: response.id,
    type: extensionOf(response, EXTENSION_TYPE_RAW) ?? "message",
    role: extensionOf(response, EXTENSION_ROLE_RAW) ?? "assistant",
    content: encodeBlockList(response.content),
    model: response.model,
    stop_reason: extensionOf(response, EXTENSION_STOP_REASON_RAW) ?? response.stopReason,
    stop_sequence: extensionOf(response, EXTENSION_STOP_SEQUENCE_RAW) ?? null,
  };
  if (response.usage != null) wire.usage = encodeUsage(response.usage);
  copyWireExtensions(response, wire);
  return wire;
}
