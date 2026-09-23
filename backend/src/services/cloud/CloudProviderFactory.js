const AzureProvider = require('./AzureProvider');
const AwsProvider = require('./AwsProvider');
const GcpProvider = require('./GcpProvider');

const providers = {
  AZURE: new AzureProvider(),
  AWS: new AwsProvider(),
  GCP: new GcpProvider()
};

/**
 * Cloud Provider Factory resolving provider instances by provider type.
 */
class CloudProviderFactory {
  /**
   * Retrieves provider instance by identifier ('AZURE', 'AWS', 'GCP').
   */
  static getProvider(providerName) {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name is required');
    }

    const key = providerName.trim().toUpperCase();
    const provider = providers[key];

    if (!provider) {
      throw new Error(`Unsupported cloud provider '${providerName}'. Supported providers: ${Object.keys(providers).join(', ')}`);
    }

    return provider;
  }

  /**
   * Lists all supported cloud providers with their explicit capabilities.
   */
  static listSupportedProviders() {
    return Object.entries(providers).map(([name, instance]) => ({
      provider: name,
      capabilities: instance.getCapabilities()
    }));
  }
}

module.exports = CloudProviderFactory;
