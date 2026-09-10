# Azure Deployment

These Bicep templates deploy the widget and Express API together on Azure Container Apps. They connect to an **existing Microsoft Foundry project and published agent**; they do not create or change the agent, model deployment, search indexes, or knowledge sources. This preserves the chatbot's existing behavior and avoids assuming model quota or duplicating its data.

## Resources

| Resource | Purpose |
| --- | --- |
| Resource group | Contains all new hosting resources |
| Container Apps environment | Consumption workload profile, managed HTTPS ingress |
| Container App | 0.5 vCPU, 1 GiB, one warm replica, port 3001 |
| Azure Container Registry | Basic SKU, admin credentials disabled, authenticated image pulls |
| User-assigned managed identity | Passwordless Foundry access and registry pulls |
| Log Analytics workspace | Container console and system logs, 30-day retention, 1 GB daily ingestion cap |
| Role assignments | AcrPull on the new registry; Azure AI User on the existing Foundry project |

The hosting resource group is named `rg-<environmentName>`. Resource names and role assignment IDs are deterministic. Re-running deployment updates the same resources with a uniquely tagged image. A second environment name creates separate hosting resources.

## Prerequisites

- Azure CLI 2.61 or newer, Bicep CLI (`az bicep install`), Bash, and Node.js 22 or newer. A local Docker daemon is not required: the deployment script builds in ACR Tasks.
- An Azure login (`az login`) with permission to deploy resource groups at subscription scope and resources within them. Contributor plus Role Based Access Control Administrator at the required scopes, or Owner, are examples. The deployer also needs role-assignment permission on the existing Foundry project, plus permission to run ACR builds. The app itself receives only its two runtime roles.
- Register `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights`, and `Microsoft.CognitiveServices` in the relevant subscriptions before deployment. For example: `az provider register --namespace Microsoft.App --subscription <subscription-id> --wait`.
- An existing `Microsoft.CognitiveServices/accounts/projects` Foundry project, its HTTPS project endpoint, and a published agent name. Legacy hub-based projects are not supported by this application. The project may be in another subscription in the same Entra tenant.
- Public network access to the Foundry endpoint from Container Apps. This baseline does not provision private endpoints, private DNS, a VNet, firewall exceptions, or custom domains. A private-only Foundry deployment requires a separately designed network integration.
- An Azure region supporting Container Apps and capacity for the requested resources. ACR Tasks must be available for the subscription.

Use the project endpoint from the Foundry portal, not an Azure OpenAI `/openai/` endpoint. Verify that the account, resource group, project name and endpoint all identify the same project.

## Configure and Deploy

From the repository root, create an environment-specific parameter file:

```bash
cp infra/main.bicepparam infra/dev.local.bicepparam
```

Edit the local parameter file and replace every `REPLACE_WITH...` value. Set `environmentName` and `location`. For a Foundry project in another subscription, also add `param foundrySubscriptionId = '<foundry-subscription-id>'`. Local parameter files are gitignored; the checked-in example contains no credentials.

Review the foundational resource changes without deploying:

```bash
bash infra/deploy.sh <hosting-subscription-id> infra/dev.local.bicepparam --what-if
```

The first-stage preview excludes the Container App because its image does not exist yet. Deploy with:

```bash
bash infra/deploy.sh <hosting-subscription-id> infra/dev.local.bicepparam
```

The script provisions the infrastructure and role assignments, builds/tests the image remotely, deploys the Container App, prints its HTTPS URL and embed script, and checks `/api/status`. It does not change your default Azure subscription. Build uploads use an allowlisted `.dockerignore`; `.env`, Azure credentials, Git history, and local dependencies are excluded. The runtime image runs as the non-root `node` user and contains compiled JavaScript, static assets, and production dependencies only.

New managed-identity and RBAC assignments can take several minutes to propagate. If the image pull or final connectivity check fails for that reason, inspect the error, allow propagation, and rerun. The script does not delete resources on a failed deployment.

To preview or deploy the app separately after building an image, use:

```bash
az deployment sub what-if --subscription <hosting-subscription-id> \
  --location eastus2 --template-file infra/main.bicep \
  --parameters infra/dev.local.bicepparam \
  deployApplication=true containerImage=<registry>.azurecr.io/chatbot:<tag>
```

Replace `what-if` with `create` to apply it. Use the same location and environment parameters as the first stage. A specific existing image tag or digest can also be used to roll back the code. Foundation-only deployments are incremental and do not remove an already deployed Container App.

## Verify and Embed

```bash
curl --fail https://<app-fqdn>/api/status
curl --fail https://<app-fqdn>/treasurer-chat.js
curl --no-buffer --fail https://<app-fqdn>/api/chat \
  -H 'Content-Type: application/json' -H 'Accept: application/x-ndjson' \
  --data '{"message":"What does the State Treasurer do?"}'
```

The chat check incurs normal Foundry usage charges. Expect `start`, incremental `delta`, and final `done` events. Also open the widget, ask a follow-up, and confirm citation links. TCP startup, liveness and readiness probes check the process without repeatedly calling Foundry; `/api/status` is the separate dependency check.

Add the emitted script to the host website:

```html
<script src="https://<app-fqdn>/treasurer-chat.js" defer></script>
```

If the host has a Content Security Policy, permit the app origin in both `script-src` and `frame-src`. API calls originate inside the widget iframe on the same origin as the API, so production does not require permissive cross-origin CORS settings. Do not add `X-Frame-Options: DENY` or `SAMEORIGIN` on the widget. Any additional gateway must support incremental responses and disable buffering on `/api/chat`. Container Apps managed HTTP ingress has a request timeout of approximately 240 seconds; long-running agent tools must fit within it.

## Operations and Limits

- One warm replica avoids scale-to-zero latency. One maximum replica and single active revision accommodate the server's process-local citation allowlist. A restart or new revision still clears that allowlist, so old file citation downloads may return 404. Implement shared, session-scoped citation authorization before horizontal scaling; this baseline is not highly available.
- The API is intentionally anonymous for a public widget. CORS is not authentication or abuse protection. Before a public production launch, address rate limiting, budget alerts, conversation/file authorization, retention, and access controls as required. This template does not provide a WAF or claim to make the current API production-hardened.
- Foundry authentication uses `DefaultAzureCredential` and the identity's `AZURE_CLIENT_ID`. No API keys or client secrets are stored in parameters or the frontend. Foundry tools may need their own existing permissions; the widget identity's project role does not grant tool access to unrelated resources.
- Container hosting, ACR, builds, logs and Foundry usage incur charges. The log cap is not an overall spending limit and can stop log ingestion when reached. The warm replica continues to cost money while idle. Review Azure budgets and service prices before deployment.
- Logs go to Log Analytics. Avoid logging prompts, responses, or credentials. Follow current container logs with `az containerapp logs show --subscription <subscription-id> --resource-group rg-<environmentName> --name ca-<environmentName> --follow` (requires the Azure CLI Container Apps extension).
- No automatic CI/CD or publishing occurs. Run the deployment script again after code changes. Pin approved base image digests and configure image retention/scanning for your organization's release process.

## Local Validation

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null
az bicep build-params --file infra/main.bicepparam --stdout > /dev/null
bash -n infra/deploy.sh
npm test
npm run lint
docker build -t foundry-chatbot:local .
```

Local compilation does not validate subscription permissions, quota, networking, role propagation or the existing agent. Use the deployment preview and post-deployment checks for those environment-specific requirements. A local container does not inherit your host's Azure CLI credentials or an Azure managed identity.

## Cleanup

First retrieve the identity principal ID while the resource group still exists:

```bash
az identity show --subscription <hosting-subscription-id> \
  --resource-group rg-<environmentName> --name id-<environmentName> \
  --query principalId --output tsv
```

Remove only that identity's Azure AI User assignment on the existing Foundry project:

```bash
az role assignment delete --subscription <foundry-subscription-id> \
  --assignee-object-id <identity-principal-id> \
  --role 53ca6127-db72-4b80-b1b0-d745d6d5456d \
  --scope /subscriptions/<foundry-subscription-id>/resourceGroups/<foundry-rg>/providers/Microsoft.CognitiveServices/accounts/<foundry-account>/projects/<foundry-project>
```

Then delete the hosting resource group (destructive; review its contents first):

```bash
az group delete --subscription <hosting-subscription-id> --name rg-<environmentName>
```

This preserves the existing Foundry account, project, agent and data. The cross-resource-group role assignment is removed separately above to avoid leaving an orphaned principal. Subscription deployment history may remain, but does not itself incur hosting charges.