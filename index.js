// -----------------------------------------------------------------------------
// Entry point of the Fully Kiosk Browser external integration.
//
// Role of this file: connect directly to the user's MQTT broker (plain
// outbound TCP - no mediation needed, unlike SSDP/mDNS multicast) to discover
// tablets from the deviceInfo reports Fully Kiosk already publishes, then
// dispatch Gladys commands to each tablet's local REST API (src/devices.js,
// src/FullyKioskClient.js). See docs/en.md for the full setup.
// -----------------------------------------------------------------------------

import mqtt from 'mqtt';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { sendCommand, getDeviceInfo } from './src/FullyKioskClient.js';
import {
  normalizeDeviceInfo,
  convertToGladysDevice,
  buildStatesFromDeviceInfo,
  resolveHttpTarget,
  setDeviceValue,
} from './src/devices.js';
import {
  CONFIG_SCHEMA_KEYS,
  DEFAULT_MQTT_PORT,
  DEFAULT_MQTT_TOPIC_PREFIX,
  REPUBLISH_DEBOUNCE_MS,
} from './src/constants.js';

const gladys = new GladysIntegration();

// Latest known deviceInfo per Fully Kiosk deviceId - the discovery cache this
// integration publishes from. Lost on restart, rebuilt from the next round of
// MQTT reports (Fully Kiosk re-publishes deviceInfo periodically on its own).
const knownDevices = new Map();

let mqttClient;
let republishTimer;

/**
 * Publish the full discovered-device list built from `knownDevices`.
 * @returns {Promise<void>} Resolves once published.
 */
async function publishAllDiscovered() {
  const devices = [...knownDevices.values()].map((info) => convertToGladysDevice(gladys, info));
  try {
    await gladys.publishDiscoveredDevices(devices);
    await gladys.setConnectionStatus(devices.length > 0).catch(() => {});
  } catch (e) {
    logger.error(`Fully Kiosk: unable to publish devices: ${e.message}`);
  }
}

/**
 * Debounce publishAllDiscovered so a burst of MQTT messages (e.g. every
 * tablet reporting at once on broker reconnect) triggers one publish, not one
 * per tablet.
 */
function scheduleRepublish() {
  clearTimeout(republishTimer);
  republishTimer = setTimeout(publishAllDiscovered, REPUBLISH_DEBOUNCE_MS);
}

/**
 * Handle one incoming MQTT message: normalize it, update the discovery
 * cache, and either publish the new device or just its fresh state.
 * @param {Buffer} payload - The raw MQTT message payload.
 * @returns {Promise<void>} Resolves once handled.
 */
async function handleMqttMessage(payload) {
  let json;
  try {
    json = JSON.parse(payload.toString('utf8'));
  } catch {
    return; // Not a JSON payload - not a Fully Kiosk deviceInfo report.
  }
  const deviceInfo = normalizeDeviceInfo(json);
  if (!deviceInfo) {
    return;
  }
  logger.debug(`Fully Kiosk: deviceInfo received for ${deviceInfo.deviceId}: ${payload}`);

  const isNew = !knownDevices.has(deviceInfo.deviceId);
  knownDevices.set(deviceInfo.deviceId, deviceInfo);

  if (isNew) {
    scheduleRepublish();
    return;
  }
  const states = buildStatesFromDeviceInfo(gladys, deviceInfo);
  if (states.length > 0) {
    await gladys
      .publishStates(states)
      .catch((e) => logger.error(`Fully Kiosk: publishStates failed: ${e.message}`));
  }
}

/**
 * Disconnect the current MQTT client, if any.
 */
function disconnectMqtt() {
  if (mqttClient) {
    mqttClient.removeAllListeners();
    mqttClient.end(true);
    mqttClient = undefined;
  }
}

/**
 * (Re)connect to the MQTT broker using the current integration config, and
 * subscribe to the configured topic prefix.
 * @returns {Promise<void>} Resolves once the connection attempt is wired up.
 */
async function connectMqttFromConfig() {
  const config = (await gladys.getConfig()) || {};
  const host = config[CONFIG_SCHEMA_KEYS.MQTT_HOST];
  disconnectMqtt();

  if (!host) {
    logger.info('Fully Kiosk: no MQTT broker configured yet, waiting for configuration.');
    return;
  }

  const port = Number(config[CONFIG_SCHEMA_KEYS.MQTT_PORT]) || DEFAULT_MQTT_PORT;
  const useTls = !!config[CONFIG_SCHEMA_KEYS.MQTT_USE_TLS];
  const topicPrefix = config[CONFIG_SCHEMA_KEYS.MQTT_TOPIC_PREFIX] || DEFAULT_MQTT_TOPIC_PREFIX;
  const url = `${useTls ? 'mqtts' : 'mqtt'}://${host}:${port}`;

  logger.info(`Fully Kiosk: connecting to MQTT broker ${url}...`);
  mqttClient = mqtt.connect(url, {
    username: config[CONFIG_SCHEMA_KEYS.MQTT_USERNAME] || undefined,
    password: config[CONFIG_SCHEMA_KEYS.MQTT_PASSWORD] || undefined,
    reconnectPeriod: 5000,
  });

  mqttClient.on('connect', () => {
    logger.info(`Fully Kiosk: connected to MQTT broker, subscribing to "${topicPrefix}/#"`);
    mqttClient.subscribe(`${topicPrefix}/#`, (err) => {
      if (err) {
        logger.error(`Fully Kiosk: MQTT subscribe failed: ${err.message}`);
      }
    });
    gladys.setConnectionStatus(true).catch(() => {});
  });

  mqttClient.on('message', (_topic, payload) => {
    handleMqttMessage(payload).catch((e) =>
      logger.error(`Fully Kiosk: error handling MQTT message: ${e.message}`),
    );
  });

  mqttClient.on('error', (err) => {
    logger.error(`Fully Kiosk: MQTT error: ${err.message}`);
    gladys
      .setConnectionStatus(false, {
        en: `MQTT error: ${err.message}`,
        fr: `Erreur MQTT : ${err.message}`,
      })
      .catch(() => {});
  });
}

// --- Discovery: the user asks for the list of devices ------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing known Fully Kiosk tablets');
  await publishAllDiscovered();
});

// --- Command: the user acts on a device feature -------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const config = (await gladys.getConfig()) || {};
  const target = resolveHttpTarget(config, device);
  await setDeviceValue(sendCommand, target, feature, value);
});

// --- Poll: Gladys asks for the current state of a device ---------------------
// Fallback / on-demand refresh, complementing the MQTT push - useful right
// after a tablet is created, before its next scheduled MQTT report.
gladys.onPoll(async (device) => {
  try {
    const config = (await gladys.getConfig()) || {};
    const target = resolveHttpTarget(config, device);
    const deviceInfo = normalizeDeviceInfo(await getDeviceInfo(target));
    if (!deviceInfo) {
      return;
    }
    knownDevices.set(deviceInfo.deviceId, deviceInfo);
    const states = buildStatesFromDeviceInfo(gladys, deviceInfo);
    if (states.length > 0) {
      await gladys.publishStates(states);
    }
  } catch (e) {
    logger.debug(`Fully Kiosk: poll failed for ${device.name}: ${e.message}`);
  }
});

// --- Manifest action: refresh the tablet list now -----------------------------
gladys.onAction('scan_now', async () => {
  logger.info('Action scan_now -> publishing known Fully Kiosk tablets');
  await publishAllDiscovered();
  return {
    en: `${knownDevices.size} tablet(s) known.`,
    fr: `${knownDevices.size} tablette(s) connue(s).`,
  };
});

// --- Configuration updated by the user (broker, topic prefix, passwords...) --
gladys.onConfigUpdated(async () => {
  logger.info('onConfigUpdated -> reconnecting to MQTT with the updated configuration');
  await connectMqttFromConfig();
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  await connectMqttFromConfig();
});

gladys.handleShutdown(() => {
  disconnectMqtt();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Fully Kiosk integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
