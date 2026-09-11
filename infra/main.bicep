targetScope = 'subscription'

@description('Lowercase letters, numbers and hyphens; used as the deployment name prefix.')
@minLength(3)
@maxLength(20)
param environmentName string

@description('Azure region supporting Linux Azure App Service.')
param location string

@description('Subscription containing the existing Foundry project. Must use the same Entra tenant.')
param foundrySubscriptionId string = subscription().subscriptionId

param foundryResourceGroupName string
param foundryAccountName string
param foundryProjectName string

@description('Existing project endpoint: https://<subdomain>.services.ai.azure.com/api/projects/<project>.')
param foundryProjectEndpoint string

@description('Name of the existing published Foundry agent, not a model deployment name.')
param foundryAgentName string

param tags object = {
  application: 'foundry-chatbot'
  environment: environmentName
  managedBy: 'bicep'
}

resource appResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module foundation 'modules/foundation.bicep' = {
  name: '${environmentName}-foundation'
  scope: appResourceGroup
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

module application 'modules/app.bicep' = {
  name: '${environmentName}-application'
  scope: appResourceGroup
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    planId: foundation.outputs.planId
    foundryProjectEndpoint: foundryProjectEndpoint
    foundryAgentName: foundryAgentName
  }
}

module foundryAccess 'modules/foundry-access.bicep' = {
  name: '${environmentName}-foundry-access'
  scope: resourceGroup(foundrySubscriptionId, foundryResourceGroupName)
  params: {
    foundryAccountName: foundryAccountName
    foundryProjectName: foundryProjectName
    principalResourceId: application.outputs.appId
    principalId: application.outputs.principalId
  }
}

output resourceGroupName string = appResourceGroup.name
output webAppName string = application.outputs.appName
output identityPrincipalId string = application.outputs.principalId
output widgetUrl string = application.outputs.widgetUrl
output embedScript string = application.outputs.embedScript
