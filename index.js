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
  shouldPoll,
} from './src/devices.js';
import {
  ensureManagedBrokerCredentials,
  findManagedBrokerHostPort,
  buildCredentialsMessage,
  writeManagedBrokerConfig,
} from './src/managedBroker.js';
import { setTabletCredential } from './src/tabletCredentials.js';
import {
  CONFIG_SCHEMA_KEYS,
  SET_TABLET_PASSWORD_FIELDS,
  ADD_TABLET_BY_IP_FIELDS,
  BROKER_MODE,
  MANAGED_BROKER,
  DEFAULT_MQTT_PORT,
  DEFAULT_MQTT_TOPIC_PREFIX,
  DEFAULT_HTTP_PORT,
  REPUBLISH_DEBOUNCE_MS,
  HTTP_POLL_INTERVAL_MS,
} from './src/constants.js';

const gladys = new GladysIntegration();

// Epoch ms of each device's last REAL poll (external_id -> timestamp) - see
// shouldPoll in src/devices.js: Gladys calls onPoll every 60s (its own
// maximum poll_frequency), this throttles that down further.
const lastPolledAt = new Map();

// The managed-broker credentials last used to (re)write its config and start
// it - see resolveBrokerConnection. connectMqttFromConfig can run more than
// once in a row with nothing actually different (e.g. the 'connected' event
// and an initial onConfigUpdated both firing at startup): re-running
// startContainer on an already-running container restarts it (observed
// live: "mosquitto version 2.0.18 terminating" seconds after "running",
// briefly dropping every already-connected client, tablets included) - this
// skips that when the credentials haven't changed since the last start.
let lastManagedBrokerCredentials;

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
 * Resolve how to connect to the MQTT broker for the current config: either
 * start (or confirm running) this integration's own Mosquitto sub-container
 * ("managed" mode), or use the user-provided broker details ("external"
 * mode) - stopping the sub-container if it was previously running, so
 * switching modes never leaves an orphaned broker behind.
 * @param {object} config - The integration config (gladys.getConfig()).
 * @returns {Promise<{url: string, username?: string, password?: string}|null>} The
 *   connection to use, or null when nothing is configured yet (external mode,
 *   no host entered).
 */
async function resolveBrokerConnection(config) {
  const mode = config[CONFIG_SCHEMA_KEYS.BROKER_MODE] || BROKER_MODE.MANAGED;

  if (mode === BROKER_MODE.DISABLED) {
    await gladys.stopContainer(MANAGED_BROKER.CONTAINER_NAME).catch(() => {});
    // Force the next switch back to managed mode to call startContainer
    // again, even with unchanged credentials - it was just stopped.
    lastManagedBrokerCredentials = undefined;
    return null;
  }

  if (mode === BROKER_MODE.EXTERNAL) {
    await gladys.stopContainer(MANAGED_BROKER.CONTAINER_NAME).catch(() => {});
    // Force the next switch back to managed mode to call startContainer
    // again, even with unchanged credentials - it was just stopped.
    lastManagedBrokerCredentials = undefined;
    const host = config[CONFIG_SCHEMA_KEYS.MQTT_HOST];
    if (!host) {
      return null;
    }
    const port = Number(config[CONFIG_SCHEMA_KEYS.MQTT_PORT]) || DEFAULT_MQTT_PORT;
    const useTls = !!config[CONFIG_SCHEMA_KEYS.MQTT_USE_TLS];
    return {
      url: `${useTls ? 'mqtts' : 'mqtt'}://${host}:${port}`,
      username: config[CONFIG_SCHEMA_KEYS.MQTT_USERNAME] || undefined,
      password: config[CONFIG_SCHEMA_KEYS.MQTT_PASSWORD] || undefined,
    };
  }

  const { username, password } = await ensureManagedBrokerCredentials(gladys);
  const alreadyStarted =
    lastManagedBrokerCredentials?.username === username &&
    lastManagedBrokerCredentials?.password === password;
  if (!alreadyStarted) {
    writeManagedBrokerConfig(username, password);
    await gladys.startContainer(MANAGED_BROKER.CONTAINER_NAME);
    lastManagedBrokerCredentials = { username, password };
  }
  return {
    url: `mqtt://${MANAGED_BROKER.CONTAINER_NAME}:${MANAGED_BROKER.CONTAINER_PORT}`,
    username,
    password,
  };
}

/**
 * (Re)connect to the MQTT broker using the current integration config, and
 * subscribe to the configured topic prefix.
 * @returns {Promise<void>} Resolves once the connection attempt is wired up.
 */
async function connectMqttFromConfig() {
  const config = (await gladys.getConfig()) || {};
  disconnectMqtt();

  let connection;
  try {
    connection = await resolveBrokerConnection(config);
  } catch (e) {
    logger.error(`Fully Kiosk: unable to prepare the MQTT broker: ${e.message}`);
    await gladys
      .setConnectionStatus(false, {
        en: `Broker error: ${e.message}`,
        fr: `Erreur du broker : ${e.message}`,
      })
      .catch(() => {});
    return;
  }

  if (!connection) {
    const mode = config[CONFIG_SCHEMA_KEYS.BROKER_MODE] || BROKER_MODE.MANAGED;
    if (mode === BROKER_MODE.DISABLED) {
      logger.info('Fully Kiosk: MQTT disabled, only tablets added by IP will be used.');
      await gladys.setConnectionStatus(true).catch(() => {});
    } else {
      logger.info('Fully Kiosk: no MQTT broker configured yet, waiting for configuration.');
    }
    return;
  }

  const topicPrefix = config[CONFIG_SCHEMA_KEYS.MQTT_TOPIC_PREFIX] || DEFAULT_MQTT_TOPIC_PREFIX;

  logger.info(`Fully Kiosk: connecting to MQTT broker ${connection.url}...`);
  mqttClient = mqtt.connect(connection.url, {
    username: connection.username,
    password: connection.password,
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
  const now = Date.now();
  if (!shouldPoll(lastPolledAt.get(device.external_id), now, HTTP_POLL_INTERVAL_MS)) {
    return;
  }
  lastPolledAt.set(device.external_id, now);

  // Gladys' onPoll payload does not reliably carry `name` - fall back to the
  // external_id so the Journaux stay readable either way.
  const deviceLabel = device.name || device.external_id;
  logger.info(`onPoll <- ${deviceLabel}`);
  try {
    const config = (await gladys.getConfig()) || {};
    const target = resolveHttpTarget(config, device);
    const deviceInfo = normalizeDeviceInfo(await getDeviceInfo(target));
    if (!deviceInfo) {
      logger.info(`onPoll -> ${deviceLabel}: deviceInfo response was not recognized`);
      return;
    }
    knownDevices.set(deviceInfo.deviceId, deviceInfo);
    const states = buildStatesFromDeviceInfo(gladys, deviceInfo);
    if (states.length > 0) {
      await gladys.publishStates(states);
    }
    logger.info(`onPoll -> ${deviceLabel}: published ${states.length} state(s)`);
  } catch (e) {
    logger.error(`onPoll -> ${deviceLabel} failed: ${e.message}`);
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

// --- Manifest action: reveal the managed broker's credentials ----------------
gladys.onAction('show_broker_credentials', async () => {
  const config = (await gladys.getConfig()) || {};
  if ((config[CONFIG_SCHEMA_KEYS.BROKER_MODE] || BROKER_MODE.MANAGED) !== BROKER_MODE.MANAGED) {
    return {
      en: 'The managed broker is not enabled (the "MQTT broker" mode is not set to "Run a dedicated broker").',
      fr: "Le broker dédié n'est pas activé (le mode « Broker MQTT » n'est pas réglé sur « Lancer un broker dédié »).",
    };
  }
  const { username, password } = await ensureManagedBrokerCredentials(gladys);
  const containers = await gladys.getContainers().catch(() => []);
  const hostPort = findManagedBrokerHostPort(containers);
  return buildCredentialsMessage({ username, password, hostPort });
});

// --- Manifest action: set one tablet's REST API password ---------------------
gladys.onAction('set_tablet_password', async (fields) => {
  const deviceExternalId = fields[SET_TABLET_PASSWORD_FIELDS.DEVICE];
  const password = fields[SET_TABLET_PASSWORD_FIELDS.PASSWORD];
  const port = fields[SET_TABLET_PASSWORD_FIELDS.PORT];
  if (!deviceExternalId || !password) {
    return {
      en: 'Pick a tablet and enter its REST API password.',
      fr: 'Choisissez une tablette et renseignez son mot de passe API REST.',
    };
  }
  await setTabletCredential(gladys, deviceExternalId, {
    password,
    port: port ? Number(port) : undefined,
  });
  logger.info(`Action set_tablet_password -> saved for ${deviceExternalId}`);
  return {
    en: 'Password saved for this tablet.',
    fr: 'Mot de passe enregistré pour cette tablette.',
  };
});

// --- Manifest action: add a tablet by IP, without waiting for an MQTT report -
// The alternative discovery path for a tablet running Fully Kiosk's free
// edition (deviceInfo-over-MQTT is a PLUS-licensed feature - see docs). Talks
// straight to the tablet's REST API, which also validates the IP/password.
gladys.onAction('add_tablet_by_ip', async (fields) => {
  const ip = fields[ADD_TABLET_BY_IP_FIELDS.IP];
  const password = fields[ADD_TABLET_BY_IP_FIELDS.PASSWORD];
  const port = fields[ADD_TABLET_BY_IP_FIELDS.PORT];
  if (!ip || !password) {
    return {
      en: "Enter the tablet's IP address and its REST API password.",
      fr: "Renseignez l'adresse IP de la tablette et son mot de passe API REST.",
    };
  }

  const config = (await gladys.getConfig()) || {};
  const target = {
    ip,
    port: port ? Number(port) : DEFAULT_HTTP_PORT,
    password,
    useHttps: !!config[CONFIG_SCHEMA_KEYS.HTTP_USE_HTTPS],
  };

  let raw;
  try {
    raw = await getDeviceInfo(target);
  } catch (e) {
    logger.error(`Action add_tablet_by_ip -> ${ip} failed: ${e.message}`);
    return {
      en: `Could not reach the tablet at ${ip}: ${e.message}. Check the IP, port and REST API password.`,
      fr: `Impossible de joindre la tablette à l'adresse ${ip} : ${e.message}. Vérifiez l'IP, le port et le mot de passe API REST.`,
    };
  }
  const deviceInfo = normalizeDeviceInfo(raw);
  if (!deviceInfo) {
    return {
      en: `The tablet at ${ip} answered, but not with a recognizable Fully Kiosk deviceInfo response.`,
      fr: `La tablette à l'adresse ${ip} a répondu, mais pas avec une réponse deviceInfo Fully Kiosk reconnaissable.`,
    };
  }

  knownDevices.set(deviceInfo.deviceId, deviceInfo);
  const device = convertToGladysDevice(gladys, deviceInfo);
  await setTabletCredential(gladys, device.external_id, {
    password,
    port: port ? Number(port) : undefined,
  });
  await publishAllDiscovered();

  logger.info(`Action add_tablet_by_ip -> added "${device.name}" (${ip})`);
  return {
    en: `"${device.name}" added - its REST API password was saved too.`,
    fr: `« ${device.name} » ajoutée - son mot de passe API REST a aussi été enregistré.`,
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
