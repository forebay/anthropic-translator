import type { ContentBlockStartEvent, IrStreamEvent, MessageDeltaEvent, MessageStartEvent } from "@forebay/host";
import { putExtension, putUnconsumedAsExtensions } from "./extensions.js";
import { asInteger, asMap, asString, type JsonObject } from "./json-values.js";
import { SseFrameBuffer } from "./sse-frames.js";
import { stopReasonToIr } from "./stop-reason.js";
import { decodeUsage } from "./usage.js";

export const EXTENSION_STOP_SEQUENCE_RAW = "$stopSequenceRaw";

const MESSAGE_START_KNOWN_KEYS: ReadonlySet<string> = new Set([
  "id", "type", "role", "content", "model", "stop_reason", "stop_sequence", "usage",
]);
const MESSAGE_DELTA_KNOWN_KEYS: ReadonlySet<string> = new Set(["stop_reason", "stop_sequence"]);

type FrameDecoder = (frame: JsonObject) => IrStreamEvent | null;

const FRAME_DECODERS: Readonly<Record<string, FrameDecoder>> = {
  message_start: decodeMessageStart,
  content_block_start: decodeContentBlockStart,
  content_block_delta: decodeContentBlockDelta,
  content_block_stop: (frame) => ({ event: "content_block_stop", index: indexOf(frame) }),
  message_delta: decodeMessageDelta,
  message_stop: () => ({ event: "message_stop" }),
  error: decodeError,
};

function indexOf(frame: JsonObject): number {
  return asInteger(frame.index) ?? 0;
}

function assignString(target: object, field: string, value: unknown): void {
  const text = asString(value);
  if (text !== null) Object.assign(target, { [field]: text });
}

function withString<Event extends IrStreamEvent>(event: Event, field: string, value: unknown): Event {
  assignString(event, field, value);
  return event;
}

function decodeMessageStart(frame: JsonObject): MessageStartEvent | null {
  const message = asMap(frame.message);
  if (message === null) return null;
  const event: MessageStartEvent = { event: "message_start" };
  assignString(event, "id", message.id);
  assignString(event, "model", message.model);
  assignString(event, "role", message.role);
  const usage = decodeUsage(message.usage);
  if (usage !== undefined) event.usage = usage;
  putUnconsumedAsExtensions(message, MESSAGE_START_KNOWN_KEYS, event);
  return event;
}

function decodeContentBlockStart(frame: JsonObject): ContentBlockStartEvent {
  const block = asMap(frame.content_block);
  const blockType = block === null ? null : asString(block.type);
  const index = indexOf(frame);
  if (block !== null && blockType === "tool_use") {
    const event: ContentBlockStartEvent = { event: "content_block_start", index, blockKind: "tool_use" };
    assignString(event, "toolUseId", block.id);
    assignString(event, "toolName", block.name);
    return event;
  }
  const isThinking = blockType === "thinking" || blockType === "redacted_thinking";
  return { event: "content_block_start", index, blockKind: isThinking ? "thinking" : "text" };
}

function decodeContentBlockDelta(frame: JsonObject): IrStreamEvent | null {
  const index = indexOf(frame);
  const delta = asMap(frame.delta);
  if (delta === null) return null;
  switch (asString(delta.type)) {
    case "text_delta": return withString({ event: "text_delta", index }, "text", delta.text);
    case "input_json_delta": return withString({ event: "tool_input_delta", index }, "partialJson", delta.partial_json);
    case "thinking_delta": return withString({ event: "thinking_delta", index }, "text", delta.thinking);
    case "signature_delta": return withString({ event: "thinking_signature", index }, "signature", delta.signature);
    default: return null;
  }
}

function decodeMessageDelta(frame: JsonObject): MessageDeltaEvent {
  const event: MessageDeltaEvent = { event: "message_delta" };
  const delta = asMap(frame.delta);
  if (delta !== null) {
    event.stopReason = stopReasonToIr(asString(delta.stop_reason));
    putExtension(event, EXTENSION_STOP_SEQUENCE_RAW, delta.stop_sequence ?? null);
    putUnconsumedAsExtensions(delta, MESSAGE_DELTA_KNOWN_KEYS, event);
  }
  const usage = decodeUsage(frame.usage);
  if (usage !== undefined) event.usage = usage;
  return event;
}

function decodeError(frame: JsonObject): IrStreamEvent {
  const error = asMap(frame.error);
  const event: IrStreamEvent = { event: "error" };
  if (error !== null) {
    assignString(event, "errorType", error.type);
    assignString(event, "message", error.message);
  }
  return event;
}

/** @implNote A line cut short by a dropped connection is not JSON, and yields nothing just as a frame of an unknown type does. */
function frameOf(payload: string): JsonObject | null {
  try {
    return asMap(JSON.parse(payload));
  } catch {
    return null;
  }
}

export class AnthropicStreamDecoder {
  private readonly frames = new SseFrameBuffer();

  decode(chunk: string): IrStreamEvent[] {
    return this.frames.push(chunk).flatMap((payload) => this.decodePayload(payload));
  }

  flush(): IrStreamEvent[] {
    return this.frames.flush().flatMap((payload) => this.decodePayload(payload));
  }

  private decodePayload(payload: string): IrStreamEvent[] {
    const frame = frameOf(payload);
    const type = frame === null ? null : asString(frame.type);
    const decoder = type === null ? undefined : FRAME_DECODERS[type];
    const event = frame !== null && decoder !== undefined ? decoder(frame) : null;
    return event === null ? [] : [event];
  }
}

export function createDecodeStream(): TransformStream<string, IrStreamEvent> {
  const decoder = new AnthropicStreamDecoder();
  return new TransformStream({
    transform(chunk, controller) {
      for (const event of decoder.decode(chunk)) controller.enqueue(event);
    },
    flush(controller) {
      for (const event of decoder.flush()) controller.enqueue(event);
    },
  });
}
