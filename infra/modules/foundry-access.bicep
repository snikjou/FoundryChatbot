param foundryAccountName string
param foundryProjectName string
param principalResourceId string
param principalId string

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = {
  parent: account
  name: foundryProjectName
}

var azureAiUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')

resource projectAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(project.id, principalResourceId, azureAiUserRoleId)
  scope: project
  properties: {
    roleDefinitionId: azureAiUserRoleId
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
