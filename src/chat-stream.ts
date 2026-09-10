type ChatEvent =
  | { type: "start"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "done"; conversationId: string; message: string };

function parseEvent(line: string): ChatEvent {
  const event = JSON.parse(line);
  if (event?.type === "error" && typeof event.error === "string") throw new Error(event.error);
  if (event?.type === "start" && typeof event.conversationId === "string") return event;
  if (event?.type === "delta" && typeof event.text === "string") return event;
  if (event?.type === "done" && typeof event.conversationId === "string" && typeof event.message === "string") return event;
  throw new Error("The assistant returned an invalid response.");
}

export async function readChatStream(response: Response, onEvent: (event: ChatEvent) => void): Promise<void> {
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(typeof failure?.error === "string" ? failure.error : "Request failed. Please try again.");
  }
  if (!response.body) throw new Error("Streaming responses are unavailable in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseEvent(line);
        onEvent(event);
        if (event.type === "done") return;
      }
      if (done) throw new Error("The response was interrupted. Please try again.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}