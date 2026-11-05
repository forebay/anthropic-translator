import type { IrRequest, IrResponse, IrStreamEvent } from "@forebay/host";
import { decodeRequest, encodeRequest } from "./request.js";
import { decodeResponse, encodeResponse } from "./response.js";
import { createDecodeStream } from "./stream-decoder.js";
import { createEncodeStream } from "./stream-encoder.js";

export interface VendorTranslator {
  decodeRequest(body: unknown): IrRequest;
  encodeRequest(request: IrRequest): unknown;
  decodeResponse(body: unknown): IrResponse;
  encodeResponse(response: IrResponse): unknown;
  decodeStream(): TransformStream<string, IrStreamEvent>;
  encodeStream(): TransformStream<IrStreamEvent, string>;
}

export const anthropicTranslator: VendorTranslator = {
  decodeRequest,
  encodeRequest,
  decodeResponse,
  encodeResponse,
  decodeStream: createDecodeStream,
  encodeStream: createEncodeStream,
};
