targetScope = 'subscription'

@description('Lowercase letters, numbers and hyphens; used as the deployment name prefix.')
@minLength(3)
@maxLength(20)
param environmentName string

@description('Azure region supporting Azure Container Apps.')
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

@description('Enable only after the image has been pushed to the provisioned registry.')
param deployApplication bool = false

@description('Fully qualified container image with an immutable tag or digest.')
param containerImage string = ''

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

module foundryAccess 'modules/foundry-access.bicep' = {
  name: '${environmentName}-foundry-access'
  scope: resourceGroup(foundrySubscriptionId, foundryResourceGroupName)
  params: {
    foundryAccountName: foundryAccountName
    foundryProjectName: foundryProjectName
    principalId: foundation.outputs.principalId
  }
}

module application 'modules/app.bicep' = if (deployApplication) {
  name: '${environmentName}-application'
  scope: appResourceGroup
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    managedEnvironmentId: foundation.outputs.managedEnvironmentId
    identityId: foundation.outputs.identityId
    identityClientId: foundation.outputs.identityClientId
    registryLoginServer: foundation.outputs.registryLoginServer
    containerImage: containerImage
    foundryProjectEndpoint: foundryProjectEndpoint
    foundryAgentName: foundryAgentName
  }
  dependsOn: [
    foundryAccess
  ]
}

output resourceGroupName string = appResourceGroup.name
output registryName string = foundation.outputs.registryName
output registryLoginServer string = foundation.outputs.registryLoginServer
output containerAppName string = 'ca-${environmentName}'
output identityPrincipalId string = foundation.outputs.principalId
output widgetUrl string = deployApplication ? application!.outputs.widgetUrl : ''
output embedScript string = deployApplication ? application!.outputs.embedScript : ''
