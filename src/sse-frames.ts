const DATA_FIELD = "data:";

export class SseFrameBuffer {
  private pending = "";
  private dataLines: string[] = [];

  push(chunk: string): string[] {
    const payloads: string[] = [];
    this.pending += chunk;
    let newlineIndex = this.pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.pending.slice(0, newlineIndex).replace(/\r$/, "");
      this.pending = this.pending.slice(newlineIndex + 1);
      this.acceptLine(line, payloads);
      newlineIndex = this.pending.indexOf("\n");
    }
    return payloads;
  }

  private acceptLine(line: string, payloads: string[]): void {
    if (line === "") {
      this.endFrame(payloads);
    } else if (line.startsWith(DATA_FIELD)) {
      const data = line.slice(DATA_FIELD.length);
      this.dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
    }
  }

  private endFrame(payloads: string[]): void {
    if (this.dataLines.length === 0) return;
    const payload = this.dataLines.join("\n");
    this.dataLines = [];
    if (payload !== "") payloads.push(payload);
  }
}
