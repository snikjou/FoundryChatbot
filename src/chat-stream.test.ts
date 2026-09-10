import assert from "node:assert/strict";
import test from "node:test";
import { readChatStream } from "./chat-stream.js";

const encoder = new TextEncoder();
const completed = { type: "done", conversationId: "conv-1", message: "Final [source](https://example.com)" };

test("delivers partial text before the response is complete", async () => {
  let receivedDelta!: () => void;
  const firstDelta = new Promise<void>((resolve) => { receivedDelta = resolve; });
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
  }));
  const events: object[] = [];
  const reading = readChatStream(response, (event) => {
    events.push(event);
    if (event.type === "delta") receivedDelta();
  });
  streamController.enqueue(encoder.encode('{"type":"start","conversationId":"conv-1"}\n{"type":"delta","text":"First words"}\n'));
  await firstDelta;
  assert.deepEqual(events, [{ type: "start", conversationId: "conv-1" }, { type: "delta", text: "First words" }]);
  streamController.enqueue(encoder.encode(`${JSON.stringify(completed)}\n`));
  streamController.close();
  await reading;
  assert.deepEqual(events.at(-1), completed);
});

test("handles arbitrary chunk boundaries, split UTF-8, and a final line without newline", async () => {
  const delta = { type: "delta", text: "Caf\u00e9\nAnswer" };
  const bytes = encoder.encode(`${JSON.stringify(delta)}\n\n${JSON.stringify(completed)}`);
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }));
  const events: object[] = [];
  await readChatStream(response, (event) => events.push(event));
  assert.deepEqual(events, [delta, completed]);
});

test("reports truncated streams rather than treating partial text as complete", async () => {
  await assert.rejects(readChatStream(new Response('{"type":"delta","text":"Partial"}\n'), () => undefined), /interrupted/);
});

test("surfaces streamed failures and HTTP failures", async () => {
  await assert.rejects(readChatStream(new Response('{"type":"error","error":"Upstream failed"}\n'), () => undefined), /Upstream failed/);
  await assert.rejects(readChatStream(Response.json({ error: "Invalid message" }, { status: 400 }), () => undefined), /Invalid message/);
  await assert.rejects(readChatStream(new Response("Bad gateway", { status: 502 }), () => undefined), /Request failed/);
});

test("rejects malformed events and missing response bodies", async () => {
  await assert.rejects(readChatStream(new Response('{"type":"done","message":42}\n'), () => undefined), /invalid response/);
  await assert.rejects(readChatStream(new Response(null), () => undefined), /Streaming responses are unavailable/);
});