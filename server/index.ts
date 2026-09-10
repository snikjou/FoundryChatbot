import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import cors from "cors";
import express from "express";
import { formatResponse } from "./citations.js";

const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const port = Number(process.env.PORT ?? 3001);

if (!endpoint || !agentName) {
  throw new Error("FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME must be configured.");
}

const project = new AIProjectClient(endpoint, new DefaultAzureCredential());
const openAI = project.getOpenAIClient();
const app = express();
const citedFileIds = new Set<string>();

app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/status", async (_request, response) => {
  try {
    const agent = await project.agents.get(agentName);
    response.json({ connected: true, agent: agent.name });
  } catch (error) {
    console.error("Foundry status check failed:", error);
    response.status(503).json({ connected: false, error: "Unable to reach the configured Foundry agent." });
  }
});

app.post("/api/chat", async (request, response) => {
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  const existingConversationId =
    typeof request.body?.conversationId === "string" ? request.body.conversationId : undefined;

  if (!message || message.length > 8_000) {
    response.status(400).json({ error: "Message must contain between 1 and 8,000 characters." });
    return;
  }

  const streaming = request.get("accept") === "application/x-ndjson";
  const controller = new AbortController();
  const cancel = () => controller.abort();
  response.once("close", cancel);
  const writeEvent = (event: object) => response.write(`${JSON.stringify(event)}\n`);

  try {
    let conversationId = existingConversationId;
    if (!conversationId) {
      const conversation = await openAI.conversations.create({}, { signal: controller.signal });
      conversationId = conversation.id;
    }

    const parameters = { conversation: conversationId, input: [{ role: "user" as const, content: message }] };
    const options = {
      body: { agent_reference: { name: agentName, type: "agent_reference" } },
      signal: controller.signal,
    };
    let result;
    if (streaming) {
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      writeEvent({ type: "start", conversationId });

      const stream = await openAI.responses.create({ ...parameters, stream: true }, options);
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          writeEvent({ type: "delta", text: event.delta });
        } else if (event.type === "response.completed") {
          result = event.response;
          break;
        } else if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
          throw new Error("Foundry response did not complete.");
        }
      }
      if (!result) throw new Error("Foundry response stream ended before completion.");
    } else {
      result = await openAI.responses.create(parameters, options);
    }

    for (const item of result.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const annotation of part.annotations) {
          if (annotation.type === "file_citation") citedFileIds.add(annotation.file_id);
        }
      }
    }

    const reply = {
      conversationId,
      message: formatResponse(result.output, result.output_text || "I wasn't able to produce a text response."),
      responseId: result.id,
    };
    if (streaming) {
      writeEvent({ type: "done", ...reply });
      response.end();
    } else {
      response.json(reply);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("Foundry chat request failed:", error);
    const failure = { error: "The assistant could not complete that request. Please try again." };
    if (response.headersSent) {
      writeEvent({ type: "error", ...failure });
      response.end();
    } else {
      response.status(502).json(failure);
    }
  } finally {
    response.off("close", cancel);
  }
});

app.get("/api/files/:fileId/content", async (request, response) => {
  if (!citedFileIds.has(request.params.fileId)) {
    response.status(404).json({ error: "The cited source is unavailable." });
    return;
  }
  try {
    const file = await openAI.files.retrieve(request.params.fileId);
    const content = await openAI.files.content(request.params.fileId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.attachment(file.filename);
    response.send(Buffer.from(await content.arrayBuffer()));
  } catch (error) {
    console.error("Foundry citation download failed:", error);
    response.status(404).json({ error: "The cited source is unavailable." });
  }
});

app.delete("/api/conversations/:conversationId", async (request, response) => {
  try {
    await openAI.conversations.delete(request.params.conversationId);
    response.status(204).end();
  } catch (error) {
    console.error("Foundry conversation cleanup failed:", error);
    response.status(204).end();
  }
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(currentDirectory, "../dist");
app.use(express.static(distDirectory));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(distDirectory, "index.html")));

app.listen(port, "0.0.0.0", () => {
  console.log(`Foundry chatbot server listening on http://localhost:${port}`);
});
