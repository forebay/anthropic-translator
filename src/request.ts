import type { IrMessage, IrRequest, IrThinking, IrTool, IrToolChoice } from "@forebay/host";
import {
  decodeBlockList, encodeBlockList, EXTENSION_CONTENT_IS_STRING, isPlainWrappedText, wrapStringAsBlocks,
} from "./blocks.js";
import {
  copyWireExtensions, extensionOf, isExtensionFlagSet, putExtension, putUnconsumedAsExtensions,
} from "./extensions.js";
import { asBoolean, asInteger, asList, asMap, asNumber, asString, mapsIn, type JsonObject } from "./json-values.js";

const EXTENSION_SYSTEM_IS_STRING = "$systemIsString";
const EXTENSION_THINKING_TYPE = "$thinkingType";

const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "model", "system", "messages", "tools", "tool_choice", "max_tokens", "temperature",
  "top_p", "top_k", "stop_sequences", "stream", "thinking", "metadata",
]);

export function decodeRequest(body: unknown): IrRequest {
  const root = asMap(body);
  if (root === null) return { model: "", messages: [], stream: false };
  const request: IrRequest = {
    model: asString(root.model) ?? "",
    messages: decodeMessages(root.messages),
    stream: asBoolean(root.stream) === true,
  };
  assignKnownScalars(root, request);
  decodeSystem(root.system, request);
  const tools = mapsIn(root.tools);
  if (tools !== null) request.tools = tools.map(decodeTool);
  const toolChoice = asMap(root.tool_choice);
  if (toolChoice !== null) request.toolChoice = decodeToolChoice(toolChoice);
  decodeThinking(root.thinking, request);
  putUnconsumedAsExtensions(root, KNOWN_TOP_LEVEL_KEYS, request);
  return request;
}

function assignKnownScalars(root: JsonObject, request: IrRequest): void {
  const optionalFields: Array<[keyof IrRequest, unknown]> = [
    ["maxTokens", asInteger(root.max_tokens)],
    ["temperature", asNumber(root.temperature)],
    ["topP", asNumber(root.top_p)],
    ["topK", asInteger(root.top_k)],
    ["stopSequences", asList(root.stop_sequences)?.map(String) ?? null],
    ["metadata", asMap(root.metadata)],
  ];
  for (const [field, value] of optionalFields) {
    if (value !== null) Object.assign(request, { [field]: value });
  }
}

function decodeSystem(system: unknown, request: IrRequest): void {
  if (typeof system === "string") {
    request.system = wrapStringAsBlocks(system);
    putExtension(request, EXTENSION_SYSTEM_IS_STRING, true);
  } else if (system !== null && system !== undefined) {
    const blocks = decodeBlockList(system);
    if (blocks !== null) request.system = blocks;
  }
}

function decodeThinking(wire: unknown, request: IrRequest): void {
  const map = asMap(wire);
  if (map === null) return;
  const type = asString(map.type);
  const thinking: IrThinking = { enabled: type !== "disabled" };
  const budgetTokens = asInteger(map.budget_tokens);
  if (budgetTokens !== null) thinking.budgetTokens = budgetTokens;
  request.thinking = thinking;
  putExtension(request, EXTENSION_THINKING_TYPE, type);
}

function decodeMessages(wire: unknown): IrMessage[] {
  return (mapsIn(wire) ?? []).map(decodeMessage);
}

function decodeMessage(wire: JsonObject): IrMessage {
  const message: IrMessage = { role: asString(wire.role) ?? "", content: [] };
  if (typeof wire.content === "string") {
    message.content = wrapStringAsBlocks(wire.content);
    putExtension(message, EXTENSION_CONTENT_IS_STRING, true);
  } else {
    message.content = decodeBlockList(wire.content) ?? [];
  }
  putUnconsumedAsExtensions(wire, new Set(["role", "content"]), message);
  return message;
}

function decodeTool(wire: JsonObject): IrTool {
  const tool: IrTool = { name: asString(wire.name) ?? "", inputSchema: wire.input_schema ?? null };
  const description = asString(wire.description);
  if (description !== null) tool.description = description;
  putUnconsumedAsExtensions(wire, new Set(["name", "description", "input_schema"]), tool);
  return tool;
}

function decodeToolChoice(wire: JsonObject): IrToolChoice {
  const choice: IrToolChoice = { type: asString(wire.type) ?? "" };
  const name = asString(wire.name);
  if (name !== null) choice.name = name;
  putUnconsumedAsExtensions(wire, new Set(["type", "name"]), choice);
  return choice;
}

export function encodeRequest(request: IrRequest): JsonObject {
  const wire: JsonObject = { model: request.model };
  encodeSystem(request, wire);
  wire.messages = request.messages.map(encodeMessage);
  if (request.tools != null) wire.tools = request.tools.map(encodeTool);
  if (request.toolChoice != null) wire.tool_choice = encodeToolChoice(request.toolChoice);
  encodeKnownScalars(request, wire);
  wire.stream = request.stream;
  if (request.thinking != null) wire.thinking = encodeThinking(request, request.thinking);
  if (request.metadata != null) wire.metadata = request.metadata;
  copyWireExtensions(request, wire);
  return wire;
}

function encodeKnownScalars(request: IrRequest, wire: JsonObject): void {
  const optionalFields: Array<[string, unknown]> = [
    ["max_tokens", request.maxTokens],
    ["temperature", request.temperature],
    ["top_p", request.topP],
    ["top_k", request.topK],
  ];
  for (const [wireField, value] of optionalFields) {
    if (value != null) wire[wireField] = value;
  }
  if (request.stopSequences != null) wire.stop_sequences = [...request.stopSequences];
}

function encodeSystem(request: IrRequest, wire: JsonObject): void {
  if (request.system == null) return;
  const plainText = isExtensionFlagSet(request, EXTENSION_SYSTEM_IS_STRING) && isPlainWrappedText(request.system);
  wire.system = plainText ? (request.system[0] as { text: string }).text : encodeBlockList(request.system);
}

function encodeThinking(request: IrRequest, thinking: IrThinking): JsonObject {
  const recordedType = asString(extensionOf(request, EXTENSION_THINKING_TYPE));
  const wire: JsonObject = { type: recordedType ?? (thinking.enabled ? "enabled" : "disabled") };
  if (thinking.budgetTokens != null) wire.budget_tokens = thinking.budgetTokens;
  return wire;
}

function encodeMessage(message: IrMessage): JsonObject {
  const wire: JsonObject = { role: message.role };
  const plainText = isExtensionFlagSet(message, EXTENSION_CONTENT_IS_STRING) && isPlainWrappedText(message.content);
  wire.content = plainText ? (message.content[0] as { text: string }).text : encodeBlockList(message.content);
  copyWireExtensions(message, wire);
  return wire;
}

function encodeTool(tool: IrTool): JsonObject {
  const wire: JsonObject = { name: tool.name };
  if (tool.description != null) wire.description = tool.description;
  wire.input_schema = tool.inputSchema;
  Object.assign(wire, tool.extensions);
  return wire;
}

function encodeToolChoice(choice: IrToolChoice): JsonObject {
  const wire: JsonObject = { type: choice.type };
  if (choice.name != null) wire.name = choice.name;
  Object.assign(wire, choice.extensions);
  return wire;
}
