// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
//   - getConfig / setConfig          -> in-memory config store (managed broker credentials)
//   - getContainers / startContainer / stopContainer -> record calls / return a seeded list
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket/MQTT broker.
// -----------------------------------------------------------------------------

export function createFakeGladys({ config: initialConfig = {}, containers = [] } = {}) {
  const published = [];
  const connectionStatuses = [];
  const startedContainers = [];
  const stoppedContainers = [];
  let config = { ...initialConfig };

  return {
    published,
    connectionStatuses,
    startedContainers,
    stoppedContainers,

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state,
          text: s.text,
        });
      }
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async getConfig() {
      return config;
    },

    async setConfig(partialConfig) {
      config = { ...config, ...partialConfig };
      return { success: true };
    },

    async getContainers() {
      return containers;
    },

    async startContainer(name, options) {
      startedContainers.push({ name, options });
      return { success: true };
    },

    async stopContainer(name) {
      stoppedContainers.push(name);
      return { success: true };
    },
  };
}
