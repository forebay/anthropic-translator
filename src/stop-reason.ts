const KNOWN_STOP_REASONS: ReadonlySet<string> = new Set(["end_turn", "max_tokens", "tool_use", "stop_sequence", "pause_turn", "refusal"]);
const UNMAPPED_STOP_REASON = "error";

export function stopReasonToIr(wireReason: string | null): string {
  return wireReason !== null && KNOWN_STOP_REASONS.has(wireReason) ? wireReason : UNMAPPED_STOP_REASON;
}

export function stopReasonToWire(irReason: string): string {
  return irReason === UNMAPPED_STOP_REASON ? "end_turn" : irReason;
}
