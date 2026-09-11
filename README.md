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

- Node.js 22.12 or newer and npm. Node.js 22 LTS is recommended.
- Azure CLI (`az`) for local authentication.
- An Azure subscription with an existing Microsoft Foundry project and a published agent. The application does not create the agent or deploy its model.
- The Foundry project endpoint and agent name, plus an Azure account authorized to use the project (for example, with the Azure AI User role at project scope).

The Express backend is included in this repository. Bicep is only needed for Azure deployment; Azure hosting requirements are covered in [the deployment guide](infra/README.md). Docker is not required.

## Run Locally

Run all commands from the repository root, the directory containing [package.json](package.json).

### 1. Install Dependencies

```bash
node --version
npm --version
npm ci
```

`npm ci` installs the versions recorded in the lockfile, including the development tools needed to build and run this project.

### 2. Sign In to Azure

```bash
az login
az account set --subscription "<subscription-id>"
```

In a remote terminal or Codespace where browser sign-in is unavailable, use `az login --use-device-code`. Select an account with access to the configured Foundry project.

### 3. Configure the Backend

Create a local environment file from [.env.example](.env.example), unless you already have one:

```bash
cp -n .env.example .env
```

Edit the local `.env` file with your actual values:

```env
FOUNDRY_PROJECT_ENDPOINT=https://<resource-name>.services.ai.azure.com/api/projects/<project-name>
FOUNDRY_AGENT_NAME=<agent-name>
PORT=3001
```

Use the **project endpoint** from the Foundry portal and the **published agent name**, not a model deployment name or an Azure OpenAI `/openai/` endpoint. Keep `PORT=3001` for the default local setup: [vite.config.ts](vite.config.ts) proxies `/api` requests to that port.

> [!IMPORTANT]
> The backend authenticates with `DefaultAzureCredential`, using your Azure CLI login locally and managed identity in Azure. No API key is required for this setup. Do not commit `.env` or expose credentials in browser code.

### 4. Start the Application

```bash
npm run dev
```

This starts both processes with automatic reload:

- Vite widget UI: `http://localhost:5173`.
- Express API: `http://localhost:3001`, accessed by the UI through Vite's `/api` proxy.

Open the Vite URL and select **Ask Treasurer Assist** to open the widget. If port 5173 is already occupied, Vite prints the next available port; use the URL shown in its output. In Codespaces, open the forwarded Vite port from VS Code's Ports view. The API port does not need to be publicly forwarded.

Stop both processes with `Ctrl+C`. Restart the backend after changing environment variables. To run the processes in separate terminals, use `npm run dev:server` and `npm run dev:client`.

### 5. Check the Connection

With the backend running:

```bash
curl --fail http://localhost:3001/api/status
```

A successful response contains `"connected": true` and the agent name. Then send a question in the widget and confirm that the answer streams in. Chat requests use your configured Foundry resources and incur normal service charges.

## Run a Production Build

After installing dependencies, signing in, and configuring `.env` as above:

```bash
npm run build
npm start
```

Open `http://localhost:3001` (or the port specified by `PORT`). Express serves both the built widget and the API, so Vite is not needed. Stop the development backend first if it is already using port 3001. Re-run `npm run build` after frontend or backend changes.

`npm run build` compiles the server into `build/server` and the UI into `dist`. `npm start` runs the compiled server with Node.js; `tsx` and other development dependencies are not needed at runtime. Build with development dependencies installed before pruning or installing production-only dependencies. Run from the repository root so the server can find `dist` and your local `.env`.

## Tests and Checks

```bash
npm test
npm run lint
npm run build
```

The automated tests cover streaming response handling, citation formatting, and the deployment script's preview, packaging, and failure handling. They use mocked Azure commands and do not require Azure credentials. The build type-checks the project and produces the widget assets and compiled server; it does not deploy anything to Azure.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Backend exits with a configuration error | Ensure `.env` is in the repository root and both Foundry variables contain real values. Run commands from that directory. |
| Widget says "Temporarily unavailable" or `/api/status` returns 503 | Run `az login` again if needed; verify the selected account, project endpoint, published agent name, and project permissions. Check the backend terminal for the underlying error. New role assignments can take time to propagate. |
| Port 3001 is already in use | Stop the other backend process. If you change `PORT`, also update Vite's proxy target for development. |
| UI opens but API requests fail | Confirm both development processes are running and the Vite proxy targets the backend port. |
| Production page is missing or outdated | Run `npm run build` before `npm start`; the backend serves the generated assets. |
| Answers take time to begin | Streaming displays text as soon as Foundry produces it, but model inference and agent tools can still delay the first text. |

## Response Latency

The widget requests streaming answers with `Accept: application/x-ndjson` on `POST /api/chat`. The API sends a `start` event with the conversation ID, `delta` events as text arrives, and a `done` event containing the final citation-formatted answer. Failed or interrupted streams are shown as errors; only completed answers are saved to browser history. Clients that omit this Accept header still receive a single JSON response.

User input is submitted directly with the response request, avoiding a separate conversation-item request on follow-up turns. Streaming reduces the wait to see text, but does not shorten the agent's model inference or tool execution before its first text output.

Disable response buffering for `/api/chat` in any reverse proxy or hosting gateway. The API sets `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`, but the hosting platform must also allow incremental responses.

## Azure Deployment

Deploy the UI and API together to a single **Azure Web App** using the built-in Node.js 22 runtime. No Docker, container registry, or Container Apps environment is needed. The Web App uses a system-assigned managed identity to access your existing Foundry project.

Review the project settings in [infra/main.bicepparam](infra/main.bicepparam), then run:

```bash
az login
az bicep install
npm run deploy -- "<hosting-subscription-id>"
```

The command installs dependencies, runs tests and lint, builds the app, provisions a Basic B1 App Service plan and Web App, assigns Foundry access, uploads a production ZIP, and prints the HTTPS URL and embed script. Run the same command for subsequent updates. To preview infrastructure changes without deploying, append `--what-if`.

See [the Azure deployment guide](infra/README.md) for prerequisites, optional parameter files, permissions, migration from Container Apps, costs, and cleanup. B1 is a paid, always-on plan. Deployment does not create or modify the existing agent or model, and does not automatically delete old container resources.

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
