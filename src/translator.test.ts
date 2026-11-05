import type { IrRequest, IrResponse, IrStreamEvent } from "@forebay/host";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anthropicTranslator } from "./index.js";

interface Vector {
  direction: string;
  input: any;
  output: any;
}

const vectorsFolder = join(import.meta.dirname, "..", "test", "vectors");
const OPAQUE_KEYS = new Set(["extensions", "raw", "input", "inputSchema", "metadata"]);

function loadVectors(): Array<[string, Vector]> {
  return readdirSync(vectorsFolder)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(vectorsFolder, file), "utf8"))]);
}

function requiredByTheSchema(node: any): any {
  if (node.kind === "thinking" && node.text === null) return { ...node, text: "" };
  if (node.kind === "image" && node.mediaType === null) return { ...node, mediaType: "" };
  if (node.kind === "tool_result" && node.content === null) return { ...node, content: [] };
  return node;
}

/**
 * The vectors were recorded through the Java IR serializer, which prints an absent field as null in
 * places and violates the IR schema's required `text`, `mediaType` and `content` with null. The
 * schema form drops those nulls and fills the three required fields, and leaves every opaque
 * payload (`extensions`, `raw`, tool input) exactly as recorded.
 */
function toSchemaForm(node: any): any {
  if (Array.isArray(node)) return node.map(toSchemaForm);
  if (typeof node !== "object" || node === null) return node;
  const filled = requiredByTheSchema(node);
  const form: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filled)) {
    if (OPAQUE_KEYS.has(key)) form[key] = value;
    else if (value !== null) form[key] = toSchemaForm(value);
  }
  return form;
}

async function collect<Input, Output>(stream: TransformStream<Input, Output>, inputs: Input[]): Promise<Output[]> {
  const outputs: Output[] = [];
  const drained = stream.readable.pipeTo(new WritableStream<Output>({ write: (chunk) => void outputs.push(chunk) }));
  drained.catch(() => undefined);
  const writer = stream.writable.getWriter();
  for (const input of inputs) await writer.write(input);
  await writer.close();
  await drained;
  return outputs;
}

function runVector(vector: Vector): unknown {
  switch (vector.direction) {
    case "decodeRequest": return anthropicTranslator.decodeRequest(vector.input);
    case "encodeRequest": return anthropicTranslator.encodeRequest(toSchemaForm(vector.input) as IrRequest);
    case "decodeResponse": return anthropicTranslator.decodeResponse(vector.input);
    case "encodeResponse": return anthropicTranslator.encodeResponse(toSchemaForm(vector.input) as IrResponse);
    case "decodeStream": return collect(anthropicTranslator.decodeStream(), vector.input as string[]);
    case "encodeStream": return collect(anthropicTranslator.encodeStream(), toSchemaForm(vector.input) as IrStreamEvent[]);
    default: throw new Error(`unknown direction ${vector.direction}`);
  }
}

function expectedOf(vector: Vector): unknown {
  return vector.direction.startsWith("decode") ? toSchemaForm(vector.output) : vector.output;
}

describe("anthropic translator vectors", () => {
  const vectors = loadVectors();

  it("reads the recorded vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(40);
  });

  it.each(vectors)("%s", async (_name, vector) => {
    const actual = await runVector(vector);
    expect(actual).toEqual(expectedOf(vector));
    if (vector.direction.startsWith("encode")) expect(JSON.stringify(actual)).toBe(JSON.stringify(vector.output));
  });
});

describe("anthropic translator streaming", () => {
  const vectors = loadVectors();
  const bodies = ["stream-golden.decode", "stream-edge.decode"].map((name) => {
    const vector = vectors.find(([vectorName]) => vectorName === name)![1];
    return [name, (vector.input as string[]).join("")] as const;
  });

  it.each(bodies)("decodes %s identically at every split offset", async (_name, body) => {
    const whole = await collect(anthropicTranslator.decodeStream(), [body]);
    expect(whole.length).toBeGreaterThan(5);
    for (let offset = 0; offset <= body.length; offset += 1) {
      const split = await collect(anthropicTranslator.decodeStream(), [body.slice(0, offset), body.slice(offset)]);
      expect(split, `split at ${offset}`).toEqual(whole);
    }
  });

  it("decodes a body delivered one character at a time", async () => {
    const [, body] = bodies[0];
    const whole = await collect(anthropicTranslator.decodeStream(), [body]);
    expect(await collect(anthropicTranslator.decodeStream(), [...body])).toEqual(whole);
  });

  it("keeps a frame's state per stream, not per translator", async () => {
    const [, body] = bodies[0];
    const half = body.length / 2;
    const first = anthropicTranslator.decodeStream();
    const second = anthropicTranslator.decodeStream();
    const [firstEvents, secondEvents] = await Promise.all([
      collect(first, [body.slice(0, half), body.slice(half)]),
      collect(second, [body]),
    ]);
    expect(firstEvents).toEqual(secondEvents);
  });
});

describe("anthropic translator malformed input", () => {
  it("decodes a request that is not an object to an empty request", () => {
    expect(anthropicTranslator.decodeRequest("nope")).toEqual({ model: "", messages: [], stream: false });
  });

  it("decodes a response that is not an object to an empty response", () => {
    expect(anthropicTranslator.decodeResponse(null)).toEqual({ id: "", model: "", stopReason: "error", content: [] });
  });

  it("refuses to encode a stream event it has no frame for", () => {
    const stream = anthropicTranslator.encodeStream();
    const unknownEvent = { event: "surprise" } as unknown as IrStreamEvent;
    return expect(collect(stream, [unknownEvent])).rejects.toThrow(/unsupported/);
  });
});
