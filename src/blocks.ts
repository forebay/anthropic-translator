import type { ImageBlock, IrBlock, ThinkingBlock, ToolResultBlock } from "@forebay/host";
import {
  copyWireExtensions, extensionOf, isExtensionFlagSet, putExtension, putUnconsumedAsExtensions,
} from "./extensions.js";
import { asBoolean, asMap, asString, mapsIn, type JsonObject } from "./json-values.js";

export const EXTENSION_CONTENT_IS_STRING = "$contentIsString";
const EXTENSION_CACHE_CONTROL_EXTRA = "$cacheControlExtra";
const EXTENSION_IMAGE_SOURCE_RAW = "$imageSourceRaw";
const EXTENSION_REDACTED = "$redacted";
const EXTENSION_REDACTED_DATA = "$redactedThinkingData";

const CONSUMED_KEYS: Readonly<Record<string, readonly string[]>> = {
  text: ["text"],
  image: ["source"],
  tool_use: ["id", "name", "input"],
  tool_result: ["tool_use_id", "is_error", "content"],
  thinking: ["thinking", "signature"],
  redacted_thinking: ["data"],
};
const COMMON_CONSUMED_KEYS = ["type", "cache_control"];

type BlockDecoder = (wire: JsonObject) => IrBlock;

const DECODERS: Readonly<Record<string, BlockDecoder>> = {
  text: (wire) => ({ kind: "text", text: asString(wire.text) ?? "" }),
  image: decodeImage,
  tool_use: (wire) => ({ kind: "tool_use", id: asString(wire.id) ?? "", name: asString(wire.name) ?? "", input: wire.input ?? null }),
  tool_result: decodeToolResult,
  thinking: decodeThinking,
  redacted_thinking: decodeRedactedThinking,
};

export function wrapStringAsBlocks(text: string): IrBlock[] {
  return [{ kind: "text", text }];
}

export function isPlainWrappedText(blocks: readonly IrBlock[]): boolean {
  const [only] = blocks;
  return blocks.length === 1 && only.kind === "text" && only.cacheControl == null && only.extensions == null;
}

export function decodeBlockList(wire: unknown): IrBlock[] | null {
  return mapsIn(wire)?.map(decodeBlock) ?? null;
}

export function decodeBlock(wire: JsonObject): IrBlock {
  const type = asString(wire.type);
  const decoder = type === null ? undefined : DECODERS[type];
  if (type === null || decoder === undefined) return { kind: "unknown", raw: { ...wire } };
  const block = decoder(wire);
  decodeCacheControl(wire, block);
  putUnconsumedAsExtensions(wire, new Set([...COMMON_CONSUMED_KEYS, ...CONSUMED_KEYS[type]]), block);
  return block;
}

function decodeImage(wire: JsonObject): ImageBlock {
  const image: ImageBlock = { kind: "image", mediaType: "" };
  const source = asMap(wire.source);
  if (source === null) return image;
  const sourceType = asString(source.type);
  if (sourceType === "base64") {
    image.mediaType = asString(source.media_type) ?? "";
    const data = asString(source.data);
    if (data !== null) image.data = data;
  } else if (sourceType === "url") {
    const url = asString(source.url);
    if (url !== null) image.url = url;
  } else {
    putExtension(image, EXTENSION_IMAGE_SOURCE_RAW, source);
  }
  return image;
}

function decodeToolResult(wire: JsonObject): ToolResultBlock {
  const result: ToolResultBlock = { kind: "tool_result", toolUseId: asString(wire.tool_use_id) ?? "", content: [] };
  const isError = asBoolean(wire.is_error);
  if (isError !== null) result.isError = isError;
  if (typeof wire.content === "string") {
    result.content = wrapStringAsBlocks(wire.content);
    putExtension(result, EXTENSION_CONTENT_IS_STRING, true);
  } else {
    result.content = decodeBlockList(wire.content) ?? [];
  }
  return result;
}

function decodeThinking(wire: JsonObject): ThinkingBlock {
  const thinking: ThinkingBlock = { kind: "thinking", text: asString(wire.thinking) ?? "" };
  const signature = asString(wire.signature);
  if (signature !== null) thinking.signature = signature;
  return thinking;
}

function decodeRedactedThinking(wire: JsonObject): ThinkingBlock {
  const thinking: ThinkingBlock = { kind: "thinking", text: "" };
  putExtension(thinking, EXTENSION_REDACTED, true);
  putExtension(thinking, EXTENSION_REDACTED_DATA, wire.data ?? null);
  return thinking;
}

function decodeCacheControl(wire: JsonObject, block: IrBlock): void {
  const cacheControl = asMap(wire.cache_control);
  if (cacheControl === null) return;
  const type = asString(cacheControl.type);
  if (type !== null) block.cacheControl = type;
  const { type: _type, ...extra } = cacheControl;
  if (Object.keys(extra).length > 0) putExtension(block, EXTENSION_CACHE_CONTROL_EXTRA, extra);
}

export function encodeBlockList(blocks: readonly IrBlock[] | null | undefined): JsonObject[] {
  return (blocks ?? []).map(encodeBlock);
}

export function encodeBlock(block: IrBlock): JsonObject {
  if (block.kind === "unknown") return { ...block.raw };
  const wire = encodeBlockBody(block);
  encodeCacheControl(block, wire);
  copyWireExtensions(block, wire);
  return wire;
}

function encodeBlockBody(block: Exclude<IrBlock, { kind: "unknown" }>): JsonObject {
  switch (block.kind) {
    case "text": return { type: "text", text: block.text };
    case "image": return encodeImage(block);
    case "tool_use": return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result": return encodeToolResult(block);
    case "thinking": return encodeThinking(block);
  }
}

function encodeImage(image: ImageBlock): JsonObject {
  const wire: JsonObject = { type: "image" };
  const rawSource = asMap(extensionOf(image, EXTENSION_IMAGE_SOURCE_RAW));
  if (rawSource !== null) wire.source = rawSource;
  else if (image.data != null) wire.source = { type: "base64", media_type: image.mediaType, data: image.data };
  else if (image.url != null) wire.source = { type: "url", url: image.url };
  return wire;
}

function encodeToolResult(result: ToolResultBlock): JsonObject {
  const wire: JsonObject = { type: "tool_result", tool_use_id: result.toolUseId };
  const plainText = isExtensionFlagSet(result, EXTENSION_CONTENT_IS_STRING) && isPlainWrappedText(result.content);
  wire.content = plainText ? (result.content[0] as { text: string }).text : encodeBlockList(result.content);
  if (result.isError != null) wire.is_error = result.isError;
  return wire;
}

function encodeThinking(thinking: ThinkingBlock): JsonObject {
  if (isExtensionFlagSet(thinking, EXTENSION_REDACTED)) {
    return { type: "redacted_thinking", data: extensionOf(thinking, EXTENSION_REDACTED_DATA) };
  }
  const wire: JsonObject = { type: "thinking", thinking: thinking.text };
  if (thinking.signature != null) wire.signature = thinking.signature;
  return wire;
}

function encodeCacheControl(block: IrBlock, wire: JsonObject): void {
  if (block.cacheControl == null) return;
  const extra = asMap(extensionOf(block, EXTENSION_CACHE_CONTROL_EXTRA));
  wire.cache_control = { type: block.cacheControl, ...extra };
}
