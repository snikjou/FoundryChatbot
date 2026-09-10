#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 || ( $# -eq 3 && "$3" != '--what-if' ) ]]; then
  printf 'Usage: bash infra/deploy.sh <subscription-id> <parameters.bicepparam> [--what-if]\n' >&2
  exit 1
fi

for tool in az node; do
  if ! command -v "$tool" > /dev/null; then
    printf 'Required tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

subscription_id="$1"
parameters_path="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$2")"
mode="${3:-deploy}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

az account show --subscription "$subscription_id" --output none
az bicep version > /dev/null
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT
compiled_parameters="$temporary_directory/parameters.json"
az bicep build-params --file "$parameters_path" --outfile "$compiled_parameters"

node --input-type=module - "$compiled_parameters" <<'NODE'
import { readFileSync } from 'node:fs';
const { parameters } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [name, parameter] of Object.entries(parameters)) {
  if (typeof parameter.value === 'string' && parameter.value.includes('REPLACE_WITH')) {
    throw new Error(`Set ${name} in your parameter file before deploying.`);
  }
}
if (!/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/.test(parameters.environmentName?.value ?? '')) {
  throw new Error('environmentName must be 3-20 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit.');
}
const endpoint = new URL(parameters.foundryProjectEndpoint.value);
if (endpoint.protocol !== 'https:' || endpoint.pathname !== `/api/projects/${parameters.foundryProjectName.value}`) {
  throw new Error('Use the HTTPS endpoint for the specified Foundry project, without a trailing slash.');
}
NODE

read_parameter() {
  node -e 'const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(data.parameters[process.argv[2]]?.value ?? "");' "$compiled_parameters" "$1"
}

environment_name="$(read_parameter environmentName)"
location="$(read_parameter location)"
deployment_name="${environment_name}-infra"

if [[ "$mode" == '--what-if' ]]; then
  az deployment sub what-if \
    --subscription "$subscription_id" \
    --name "$deployment_name" \
    --location "$location" \
    --template-file infra/main.bicep \
    --parameters "@$compiled_parameters" deployApplication=false
  exit 0
fi

printf 'Provisioning registry, identity, logs, environment and Foundry access...\n'
az deployment sub create \
  --subscription "$subscription_id" \
  --name "$deployment_name" \
  --location "$location" \
  --template-file infra/main.bicep \
  --parameters "@$compiled_parameters" deployApplication=false \
  --output none

deployment_output() {
  az deployment sub show --subscription "$subscription_id" --name "$deployment_name" \
    --query "properties.outputs.$1.value" --output tsv
}

registry_name="$(deployment_output registryName)"
registry_server="$(deployment_output registryLoginServer)"
image_tag="$(node -e 'console.log(Date.now() + "-" + require("node:crypto").randomUUID().slice(0, 8))')"
image="$registry_server/chatbot:$image_tag"

printf 'Building and pushing %s using ACR Tasks...\n' "$image"
az acr build --subscription "$subscription_id" --registry "$registry_name" \
  --image "chatbot:$image_tag" --platform linux/amd64 --file Dockerfile .

printf 'Deploying the chatbot image...\n'
az deployment sub create \
  --subscription "$subscription_id" \
  --name "$deployment_name" \
  --location "$location" \
  --template-file infra/main.bicep \
  --parameters "@$compiled_parameters" deployApplication=true containerImage="$image" \
  --output none

widget_url="$(deployment_output widgetUrl)"
printf '\nWidget URL: %s\n' "$widget_url"
printf 'Embed: %s\n' "$(deployment_output embedScript)"
printf 'Checking managed-identity access to Foundry...\n'
node --input-type=module - "$widget_url" <<'NODE'
const response = await fetch(`${process.argv[2]}/api/status`, { signal: AbortSignal.timeout(30000) });
if (!response.ok) {
  throw new Error(`Deployment finished, but the Foundry check returned HTTP ${response.status}. Check project RBAC, endpoint and agent name; new role assignments may need time to propagate.`);
}
console.log('Foundry connectivity check passed.');
NODE