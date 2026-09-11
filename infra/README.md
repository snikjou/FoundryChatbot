# Azure Deployment

Deploy the widget and Express API together as a single **Azure Web App**, using App Service's built-in Node.js 22 runtime. No Docker build, container registry, or Container Apps environment is needed.

The app connects to an **existing Microsoft Foundry project and published agent**. Deployment does not create or change the agent, model deployment, search indexes, or knowledge sources.

## Resources

| Resource | Purpose |
| --- | --- |
| Resource group | Contains all new hosting resources |
| Linux App Service plan | Basic B1, one instance |
| Web App | Node.js 22 LTS, HTTPS only, TLS 1.2 minimum, Always On |
| System-assigned managed identity | Passwordless Foundry access, attached to the Web App |
| Role assignment | Azure AI User on the existing Foundry project |

The resource group is `rg-<environmentName>`, the plan is `asp-<environmentName>`, and the Web App is `app-<environmentName>-<unique-suffix>`. Names are deterministic: re-running the command updates the same resources and replaces the application package. Another environment name creates separate hosting resources.

## Prerequisites

- Linux or WSL with Bash, Node.js 22.12 or newer (22 LTS recommended), npm, `zip`, and `curl`. Builds happen locally and production dependencies are included in the ZIP; use Linux to match the hosting OS, especially if native dependencies are added later.
- Azure CLI 2.61 or newer and Bicep CLI (`az bicep install`). Use a current Azure CLI so ZIP deployment supports Entra authentication with password-based publishing disabled.
- An Azure login with permission to create resource groups at subscription scope, deploy App Service resources, and assign roles on the existing Foundry project. Contributor plus Role Based Access Control Administrator at the appropriate scopes, or Owner, are examples. The script registers `Microsoft.Web` in the hosting subscription during deployment.
- An existing `Microsoft.CognitiveServices/accounts/projects` Foundry project, its HTTPS endpoint, and a published agent name. Legacy hub-based projects are not supported. The project may be in another subscription in the same Entra tenant.
- Public network access to the Foundry endpoint from App Service. This baseline does not create private endpoints, a VNet, firewall exceptions, or custom domains. A private-only Foundry deployment requires separate network integration.
- A region with Linux App Service support and B1 capacity. B1 and Foundry usage incur charges; this is not a free-tier deployment.

## One-Command Deployment

Review [main.bicepparam](main.bicepparam). Its existing project settings are retained; verify that they refer to your intended Foundry project. Set `environmentName` and `location`, and use the published agent name, not a model deployment name. The account, resource group, project name, and HTTPS project endpoint must all identify the same project. Do not add a trailing slash to the endpoint.

From the repository root:

```bash
az login
az bicep install
npm run deploy -- "<hosting-subscription-id>"
```

In Codespaces or a remote terminal, use `az login --use-device-code` when browser sign-in is unavailable. You do not need to run `npm ci` separately: the deploy command installs its own dependencies.

The script:

1. Compiles and validates the parameter file.
2. Registers `Microsoft.Web` and runs Azure provider-level preflight validation. Quota or permission failures stop here, before building or creating app resources.
3. Installs dependencies and runs tests, lint, and the production build.
4. Packages only `package.json`, `package-lock.json`, `build/server`, `dist`, and production `node_modules` in a temporary ZIP. `.env`, source code, Git history, and local Azure credentials are excluded.
5. Deploys the App Service plan, Web App, managed identity, and Foundry role assignment in one Bicep deployment.
6. Uploads the ZIP using `az webapp deploy`, waits for startup, and prints the HTTPS URL and embed script.
7. Checks `/api/status`, retrying transient errors while new role assignments propagate.

App Service runs `npm start` with its own `PORT` environment variable. The package is prebuilt, so remote build is disabled and `WEBSITE_RUN_FROM_PACKAGE=1` mounts the ZIP read-only. No API keys, publish profiles, client secrets, Docker commands, or CI/CD service are needed. The script uses the specified subscription without changing your default subscription.

Run the same command to update the app after code changes. Deployment can restart the app and interrupt active chats; this minimal setup has no deployment slots or zero-downtime guarantee. To roll back, deploy a previously verified code version with its matching lockfile and the same parameter file.

## Preview or Use Another Environment

Preview all infrastructure changes without building, registering providers, uploading code, or creating resources:

```bash
npm run deploy -- "<hosting-subscription-id>" --what-if
```

If `Microsoft.Web` has never been registered, register it once before previewing: `az provider register --namespace Microsoft.Web --subscription <hosting-subscription-id> --wait`. The normal deploy command does this automatically.

For optional, gitignored environment-specific settings:

```bash
cp -n infra/main.bicepparam infra/dev.local.bicepparam
npm run deploy -- "<hosting-subscription-id>" infra/dev.local.bicepparam --what-if
npm run deploy -- "<hosting-subscription-id>" infra/dev.local.bicepparam
```

Edit that local file before deploying. For Foundry in another subscription, add `param foundrySubscriptionId = '<foundry-subscription-id>'`. Parameters contain resource identifiers, not credentials.

The underlying Bash entry point is also available: `bash infra/deploy.sh <subscription-id> [parameters.bicepparam] [--what-if]`.

## B1 Quota Errors

`SubscriptionIsOverQuotaForSku` with `Current Limit (B1 VMs): 0` means Azure has not allocated quota for this plan in the selected region. It is not an npm, application, or Bicep syntax error. Rebuilding the app will not resolve it.

To keep the dedicated B1 plan:

1. In Azure Portal, open **Help + support > Create a support request**.
2. Select **Service and subscription limits (quotas)** and **App Service**, using the hosting subscription and the region from your parameter file.
3. Request the minimum new B1 VM limit shown in Azure's error. For zero current usage and this one-instance plan, request a limit of at least **1**.
4. After approval, rerun the same deployment command.

Quota availability depends on the subscription offer and region; Azure may require an eligible subscription or a different region. The script does not silently change regions, upgrade tiers, or reuse another application's plan. Preflight does not reserve capacity, so deployment can still fail if capacity or quota changes afterwards.

## Migrating from Container Apps

Deploy with the existing environment parameters, verify the new Web App, and update the host website's embed script and CSP to its new `azurewebsites.net` origin.

**Old resources are not automatically deleted.** Bicep deployments are incremental. An existing Container App, Container Apps environment, registry, Log Analytics workspace, user-assigned identity, and their role assignments remain until you explicitly remove them. They may continue to incur charges. After verifying the new app, remove only the obsolete resources and the old identity's Foundry role assignment. Do not delete the resource group if it now contains the Web App or other resources you need. Browser history on the old origin does not transfer automatically.

## Verify and Embed

```bash
curl --fail https://<app-fqdn>/api/status
curl --fail https://<app-fqdn>/treasurer-chat.js
curl --no-buffer --fail https://<app-fqdn>/api/chat \
  -H 'Content-Type: application/json' -H 'Accept: application/x-ndjson' \
  --data '{"message":"What does the State Treasurer do?"}'
```

The chat check incurs normal Foundry usage charges. Expect `start`, incremental `delta`, and final `done` events. Also open the widget, ask a follow-up, and confirm citation links. Always On keeps the process warm; `/api/status` separately verifies Foundry access.

Add the emitted script to the host website:

```html
<script src="https://<app-fqdn>/treasurer-chat.js" defer></script>
```

If the host has a Content Security Policy, permit the app origin in both `script-src` and `frame-src`. API calls originate inside the widget iframe on the same origin as the API, so production does not require permissive CORS settings. Do not add `X-Frame-Options: DENY` or `SAMEORIGIN` on the widget. Additional gateways must support incremental responses and disable buffering on `/api/chat`. Linux App Service has a front-end request timeout of approximately 240 seconds; do not assume streaming removes platform limits for long-running agent tools.

## Operations and Limits

- Keep one App Service instance and one Node process: the citation allowlist is process-local. A restart or deployment clears it, so old file citations can return 404. Implement shared, session-scoped citation authorization before scaling out. This baseline is not highly available.
- The API is intentionally anonymous for a public widget. CORS is not authentication or abuse protection. Before a public production launch, address rate limiting, budget alerts, conversation/file authorization, retention, and access controls as required. This template does not provide a WAF or claim to make the current API production-hardened.
- `DefaultAzureCredential` uses the Web App's system-assigned identity. No `AZURE_CLIENT_ID` or secrets are needed. Foundry tools may still need their own existing permissions; the widget's project role does not grant tool access to unrelated resources.
- The B1 plan is billed while provisioned, including when the app is idle or stopped. Foundry usage incurs separate charges. Review service prices and configure budgets before deployment.
- Use the Web App's Deployment Center and Monitoring > Log stream in the Azure portal for deployment and startup diagnostics. Enable App Service application logging when needed; this setup does not create a Log Analytics workspace. Avoid logging prompts, responses, or credentials.
- If the final Foundry check fails, the script exits nonzero but leaves the Web App deployed. Check RBAC, endpoint, and agent settings, then rerun the printed `curl` command. New role assignments can require more time than the retry window; do not redeploy just to repeat the connectivity check.
- No automatic Git push deployment is configured. `npm run deploy -- ...` performs the complete release; FTP and SCM basic authentication are disabled, and Azure CLI deploys with your Entra login.

## Local Validation

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null
az bicep build-params --file infra/main.bicepparam --stdout > /dev/null
bash -n infra/deploy.sh
npm test
npm run lint
npm run build
```

The deployment tests mock cloud commands and do not provision resources. Local compilation and tests cannot validate subscription permissions, quota, networking, role propagation, or the existing agent. Use the infrastructure preview and post-deployment checks for those environment-specific requirements.

## Cleanup

First retrieve the identity principal ID while the resource group still exists:

```bash
az webapp identity show --subscription <hosting-subscription-id> \
  --resource-group rg-<environmentName> --name <web-app-name> \
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

This preserves the existing Foundry account, project, agent, and data when they are outside the hosting group. Remove the cross-resource-group role assignment first to avoid leaving an orphaned principal. Deleting only the Web App does not remove the billable App Service plan; deleting the reviewed hosting group removes both. Subscription deployment history may remain but does not itself incur hosting charges.