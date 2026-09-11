param environmentName string
param location string
param tags object

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'asp-${environmentName}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

output planId string = plan.id
