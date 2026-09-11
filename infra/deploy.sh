#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 || ( $# -eq 3 && "$3" != '--what-if' ) ]]; then
  printf 'Usage: npm run deploy -- <subscription-id> [parameters.bicepparam] [--what-if]\n' >&2
  exit 1
fi

for tool in az node; do
  if ! command -v "$tool" > /dev/null; then
    printf 'Required tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

subscription_id="$1"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
parameters_argument="${2:-$repo_root/infra/main.bicepparam}"
mode="${3:-deploy}"
if [[ "$parameters_argument" == '--what-if' ]]; then
  parameters_argument="$repo_root/infra/main.bicepparam"
  mode='--what-if'
fi
parameters_path="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$parameters_argument")"
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
    --parameters "@$compiled_parameters"
  exit 0
fi

for tool in npm zip curl; do
  if ! command -v "$tool" > /dev/null; then
    printf 'Required tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

printf 'Checking Azure deployment prerequisites...\n'
az provider register --subscription "$subscription_id" --namespace Microsoft.Web --wait --output none
if ! az deployment sub validate \
  --subscription "$subscription_id" \
  --name "$deployment_name" \
  --location "$location" \
  --template-file infra/main.bicep \
  --parameters "@$compiled_parameters" \
  --output none; then
  printf '\nAzure preflight failed; the app was not built or deployed.\n' >&2
  printf 'If Azure reports SubscriptionIsOverQuotaForSku, request App Service B1 quota in %s for subscription %s.\n' "$location" "$subscription_id" >&2
  printf 'Use the minimum new limit reported by Azure (at least 1 for this single-instance plan).\n' >&2
  printf 'In Azure Portal, open Help + support > Create a support request > Service and subscription limits (quotas), and select App Service.\n' >&2
  printf 'After the quota is approved or the reported error is resolved, rerun the same deploy command.\n' >&2
  exit 1
fi

printf 'Installing dependencies, testing and building the app...\n'
npm ci --include=dev
npm test
npm run lint
npm run build

printf 'Packaging compiled code and production dependencies...\n'
package_directory="$temporary_directory/package"
mkdir -p "$package_directory/build"
cp package.json package-lock.json "$package_directory/"
cp -R build/server "$package_directory/build/"
cp -R dist "$package_directory/"
npm ci --omit=dev --prefix "$package_directory"
pushd "$package_directory" > /dev/null
zip -qr "$temporary_directory/app.zip" package.json package-lock.json build dist node_modules
popd > /dev/null

printf 'Provisioning the Web App and Foundry access...\n'
az deployment sub create \
  --subscription "$subscription_id" \
  --name "$deployment_name" \
  --location "$location" \
  --template-file infra/main.bicep \
  --parameters "@$compiled_parameters" \
  --query properties.outputs --output json > "$temporary_directory/outputs.json"

deployment_output() {
  node -e 'const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); const value = data[process.argv[2]]?.value; if (typeof value !== "string" || !value) throw new Error(`Missing deployment output: ${process.argv[2]}`); console.log(value);' "$temporary_directory/outputs.json" "$1"
}

resource_group="$(deployment_output resourceGroupName)"
web_app_name="$(deployment_output webAppName)"

printf 'Deploying the app ZIP to %s...\n' "$web_app_name"
az webapp deploy \
  --subscription "$subscription_id" \
  --resource-group "$resource_group" \
  --name "$web_app_name" \
  --src-path "$temporary_directory/app.zip" \
  --type zip --clean true --restart true --track-status true --timeout 600000 \
  --output none

widget_url="$(deployment_output widgetUrl)"
printf '\nWidget URL: %s\n' "$widget_url"
printf 'Embed: %s\n' "$(deployment_output embedScript)"
printf 'Checking managed-identity access to Foundry...\n'
if ! curl --fail --silent --show-error --output /dev/null \
  --retry 8 --retry-delay 15 --retry-all-errors --retry-max-time 180 --max-time 30 \
  "$widget_url/api/status"; then
  printf 'The Web App was deployed, but the Foundry check failed. Check project RBAC, endpoint and agent name; new role assignments may need more time to propagate.\n' >&2
  printf 'Recheck with: curl --fail %s/api/status\n' "$widget_url" >&2
  exit 1
fi
printf 'Foundry connectivity check passed.\n'