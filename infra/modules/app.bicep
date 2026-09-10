param environmentName string
param location string
param tags object
param managedEnvironmentId string
param identityId string
param identityClientId string
param registryLoginServer string
@minLength(1)
param containerImage string
param foundryProjectEndpoint string
param foundryAgentName string

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${environmentName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'chatbot'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'AZURE_CLIENT_ID', value: identityClientId }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
            { name: 'FOUNDRY_AGENT_NAME', value: foundryAgentName }
          ]
          probes: [
            {
              type: 'Startup'
              tcpSocket: { port: 3001 }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 1
              failureThreshold: 60
            }
            {
              type: 'Liveness'
              tcpSocket: { port: 3001 }
              periodSeconds: 10
              timeoutSeconds: 2
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              tcpSocket: { port: 3001 }
              periodSeconds: 5
              timeoutSeconds: 2
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output widgetUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output embedScript string = '<script src="https://${app.properties.configuration.ingress.fqdn}/treasurer-chat.js" defer></script>'
