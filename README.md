# Microsoft Foundry Chatbot UI

A conversational user interface for chat experiences powered by Microsoft Foundry. This project provides the front-end experience for sending prompts, displaying streamed responses, and interacting with a Foundry-hosted AI agent or model.

## Overview

The Microsoft Foundry Chatbot UI is intended to provide a clean, accessible chat experience that can be connected to an AI application deployed through Microsoft Foundry.

Core capabilities include:

- Multi-turn conversations
- Streaming assistant responses
- Markdown and code-block rendering
- Conversation history
- Loading, empty, and error states
- Responsive and keyboard-accessible controls
- Configurable connection to a Foundry endpoint

## Prerequisites

Before connecting the UI, you will need:

- An Azure subscription
- A Microsoft Foundry project
- A deployed model or agent
- The endpoint and deployment or agent identifier for your Foundry resource
- A secure backend service that authenticates requests to Foundry

## Configuration

Copy `.env.example` to `.env` and provide the Microsoft Foundry project endpoint and agent name:

```env
FOUNDRY_PROJECT_ENDPOINT=https://<resource-name>.services.ai.azure.com/api/projects/<project-name>
FOUNDRY_AGENT_NAME=<agent-name>
PORT=3001
```

> [!IMPORTANT]
> Do not expose API keys, connection strings, or other secrets in browser code. The Express backend authenticates with `DefaultAzureCredential`, which supports Azure CLI credentials for local development and managed identity in Azure.

## Getting Started

1. Sign in to Azure with `az login` and select an account that can access the Foundry project.
2. Install dependencies with `npm install`.
3. Configure `.env` as shown above.
4. Start both services with `npm run dev`.
5. Open `http://localhost:5173`.

For a production build, run `npm run build`, then `npm start`. The Express server serves the generated `dist` directory on `http://localhost:3001`.

Additional checks:

```bash
npm test
npm run lint
npm run build
```

## Response Latency

The widget requests streaming answers with `Accept: application/x-ndjson` on `POST /api/chat`. The API sends a `start` event with the conversation ID, `delta` events as text arrives, and a `done` event containing the final citation-formatted answer. Failed or interrupted streams are shown as errors; only completed answers are saved to browser history. Clients that omit this Accept header still receive a single JSON response.

User input is submitted directly with the response request, avoiding a separate conversation-item request on follow-up turns. Streaming reduces the wait to see text, but does not shorten the agent's model inference or tool execution before its first text output.

Disable response buffering for `/api/chat` in any reverse proxy or hosting gateway. The API sets `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`, but the hosting platform must also allow incremental responses.

## Azure Deployment

The repository includes Bicep templates, a production Dockerfile, and a two-stage deployment script for Azure Container Apps with managed-identity access to your existing Foundry project. See [the Azure deployment guide](infra/README.md) for configuration, permissions, deployment, validation, costs, and cleanup. Deployment does not create or modify the existing agent or model.

## Website Embed

Deploy this application to an HTTPS host with access to the configured Foundry project. Then add the loader before the closing `</body>` tag on `treasurer.ca.gov`:

```html
<script src="https://CHATBOT-HOST/treasurer-chat.js" defer></script>
```

The script inserts an isolated iframe, so the widget's React and CSS do not conflict with the existing website. The iframe stays at the bottom-right of the page and expands only when a visitor opens the chat.

If the loader script is served from a CDN while the application runs on another host, specify the application URL:

```html
<script
	src="https://CDN-HOST/treasurer-chat.js"
	data-widget-url="https://CHATBOT-HOST"
	defer
></script>
```

The hosting Content Security Policy must allow the chatbot host in `frame-src` and the loader host in `script-src`.

## Suggested Architecture

```text
React / Vite UI
	|
	| HTTPS
	v
Express API
	|
	| Microsoft Entra ID / managed identity
	v
Microsoft Foundry agent or model deployment
```

The browser should communicate only with the application backend. The backend is responsible for authentication, request validation, Foundry communication, and returning streamed responses to the UI.

## Accessibility

Chat controls should be usable with a keyboard and assistive technologies. New messages and status changes should use appropriate live regions, focus should remain predictable, and all interactive controls should have accessible names.

## Contributing

1. Create a branch for your change.
2. Keep changes focused and add tests where applicable.
3. Verify formatting, linting, and tests before opening a pull request.
4. Do not commit local environment files or credentials.

## License

No license has been added yet. Add a license before distributing or accepting external contributions.
