import type { ContentBlockStartEvent, IrStreamEvent, MessageDeltaEvent, MessageStartEvent } from "@forebay/host";
import { copyWireExtensions, extensionOf } from "./extensions.js";
import type { JsonObject } from "./json-values.js";
import { stopReasonToWire } from "./stop-reason.js";
import { EXTENSION_STOP_SEQUENCE_RAW } from "./stream-decoder.js";
import { encodeUsage } from "./usage.js";

interface Frame {
  name: string;
  data: JsonObject;
}

function deltaFrame(index: number, delta: JsonObject): Frame {
  return { name: "content_block_delta", data: { type: "content_block_delta", index, delta } };
}

function encodeMessageStart(event: MessageStartEvent): Frame {
  const message: JsonObject = {
    id: event.id ?? null,
    type: "message",
    role: event.role ?? null,
    content: [],
    model: event.model ?? null,
    stop_reason: null,
    stop_sequence: null,
    usage: event.usage != null ? encodeUsage(event.usage) : { input_tokens: 0, output_tokens: 0 },
  };
  copyWireExtensions(event, message);
  return { name: "message_start", data: { type: "message_start", message } };
}

function encodeMessageDelta(event: MessageDeltaEvent): Frame {
  const delta: JsonObject = {
    stop_reason: event.stopReason != null ? stopReasonToWire(event.stopReason) : null,
    stop_sequence: extensionOf(event, EXTENSION_STOP_SEQUENCE_RAW) ?? null,
  };
  copyWireExtensions(event, delta);
  const usage = event.usage != null ? encodeUsage(event.usage) : { output_tokens: 0 };
  return { name: "message_delta", data: { type: "message_delta", delta, usage } };
}

function contentBlockOf(event: ContentBlockStartEvent): JsonObject {
  if (event.blockKind === "tool_use") {
    return { type: "tool_use", id: event.toolUseId ?? null, name: event.toolName ?? null, input: {} };
  }
  if (event.blockKind === "thinking") return { type: "thinking", thinking: "" };
  return { type: "text", text: "" };
}

function encodeContentBlockStart(event: ContentBlockStartEvent): Frame {
  return {
    name: "content_block_start",
    data: { type: "content_block_start", index: event.index, content_block: contentBlockOf(event) },
  };
}

function encodeFrame(event: IrStreamEvent): Frame {
  switch (event.event) {
    case "message_start": return encodeMessageStart(event);
    case "content_block_start": return encodeContentBlockStart(event);
    case "text_delta": return deltaFrame(event.index, { type: "text_delta", text: event.text ?? null });
    case "thinking_delta": return deltaFrame(event.index, { type: "thinking_delta", thinking: event.text ?? null });
    case "thinking_signature": return deltaFrame(event.index, { type: "signature_delta", signature: event.signature ?? null });
    case "tool_input_delta": return deltaFrame(event.index, { type: "input_json_delta", partial_json: event.partialJson ?? null });
    case "content_block_stop": return { name: "content_block_stop", data: { type: "content_block_stop", index: event.index } };
    case "message_delta": return encodeMessageDelta(event);
    case "message_stop": return { name: "message_stop", data: { type: "message_stop" } };
    case "error": return { name: "error", data: { type: "error", error: { type: event.errorType ?? null, message: event.message ?? null } } };
    default: throw new Error(`unsupported IrStreamEvent type: ${(event as { event?: unknown }).event}`);
  }
}

export function encodeStreamEvent(event: IrStreamEvent): string {
  const frame = encodeFrame(event);
  return `event: ${frame.name}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

export function createEncodeStream(): TransformStream<IrStreamEvent, string> {
  return new TransformStream({
    transform(event, controller) {
      controller.enqueue(encodeStreamEvent(event));
    },
  });
}
