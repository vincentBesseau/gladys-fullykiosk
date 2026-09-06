// -----------------------------------------------------------------------------
// Device orchestration: MQTT deviceInfo -> Gladys device/states, and Gladys
// commands -> Fully Kiosk REST calls.
//
// External ids are `ext:<selector>:fullykiosk:<deviceId>` for a device and
// `...:<deviceId>:<featureKey>` for one of its features - `deviceId` is
// Fully Kiosk's own device identifier, read from the deviceInfo payload (see
// normalizeDeviceInfo below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { getTabletCredential } from './tabletCredentials.js';
import { DEVICE_TYPE, CONFIG_SCHEMA_KEYS, DEFAULT_HTTP_PORT, FULLY_CMD } from './constants.js';

/**
 * Read the first present key among several candidates - Fully Kiosk's exact
 * field casing has drifted across versions/doc revisions (see constants.js).
 * @param {object} payload - The raw deviceInfo payload.
 * @param {Array<string>} keys - Candidate keys, most likely first.
 * @returns {*} The first defined value found, or undefined.
 */
function pick(payload, keys) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }
  return undefined;
}

/**
 * Normalize a raw MQTT/HTTP deviceInfo payload into a shape the rest of this
 * module can rely on. Returns null when the payload does not look like a
 * Fully Kiosk deviceInfo report (no recognizable device identifier) - the
 * MQTT topic tree may carry other, unrelated messages under the same prefix.
 * @param {object} payload - The parsed JSON payload.
 * @returns {object|null} The normalized deviceInfo, or null.
 * @example
 * normalizeDeviceInfo({ deviceID: 'abc', batteryLevel: 87 });
 * // { deviceId: 'abc', deviceName: undefined, batteryLevel: 87, ... }
 */
export function normalizeDeviceInfo(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const deviceId = pick(payload, ['deviceId', 'deviceID', 'DeviceId']);
  if (!deviceId) {
    return null;
  }
  return {
    deviceId: String(deviceId),
    deviceName: pick(payload, ['deviceName', 'deviceNam']),
    ip4: pick(payload, ['ip4', 'Ip4', 'ip4Address']),
    ip6: pick(payload, ['ip6', 'Ip6', 'ip6Address']),
    mac: pick(payload, ['mac', 'macAddress', 'Mac']),
    appVersionName: pick(payload, ['appVersionName', 'kioskAppVersion']),
    batteryLevel: pick(payload, ['batteryLevel', 'battery']),
    isPlugged: pick(payload, ['isPlugged', 'plugged']),
    screenOn: pick(payload, ['screenOn', 'isScreenOn']),
    kioskMode: pick(payload, ['kioskMode', 'isInKioskMode', 'isKiosk']),
    currentPage: pick(payload, ['currentPage', 'foregroundApp']),
  };
}

/**
 * Build the Gladys device for one tablet from its (normalized) deviceInfo.
 * @param {object} gladys - The Gladys SDK instance (for externalIds).
 * @param {object} deviceInfo - A normalized deviceInfo (see normalizeDeviceInfo).
 * @returns {object} The Gladys device, with prefixed external ids.
 * @example
 * convertToGladysDevice(gladys, deviceInfo);
 */
export function convertToGladysDevice(gladys, deviceInfo) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceInfo.deviceId);
  const name = deviceInfo.deviceName || `Fully Kiosk ${deviceInfo.deviceId}`;

  const features = [
    {
      name: `${name} - Screen`,
      external_id: ids.feature('screen'),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: `${name} - Kiosk lock`,
      external_id: ids.feature('kiosk-lock'),
      category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
      type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: `${name} - Screensaver`,
      external_id: ids.feature('screensaver'),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Current page`,
      external_id: ids.feature('current-page'),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      // Gladys' t_device_feature.min/max are NOT NULL for every feature,
      // regardless of category/type - meaningless for a free-text value,
      // same placeholder gladys-sonos uses for its own TEXT/TEXT features.
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Load URL`,
      external_id: ids.feature('load-url'),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Text to speech`,
      external_id: ids.feature('text-to-speech'),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Restart app`,
      external_id: ids.feature('restart-app'),
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Reload start URL`,
      external_id: ids.feature('reload-start-url'),
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Reboot device`,
      external_id: ids.feature('reboot-device'),
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Clear cache`,
      external_id: ids.feature('clear-cache'),
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: `${name} - Exit app`,
      external_id: ids.feature('exit-app'),
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
  ];

  if (deviceInfo.batteryLevel !== undefined) {
    features.push({
      name: `${name} - Battery`,
      external_id: ids.feature('battery'),
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }

  if (deviceInfo.isPlugged !== undefined) {
    features.push({
      name: `${name} - Charging`,
      external_id: ids.feature('battery-charging'),
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.CHARGING,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }

  const params = [];
  if (deviceInfo.ip4) {
    params.push({ name: 'ip4', value: String(deviceInfo.ip4) });
  }
  if (deviceInfo.ip6) {
    params.push({ name: 'ip6', value: String(deviceInfo.ip6) });
  }
  if (deviceInfo.mac) {
    params.push({ name: 'mac_address', value: String(deviceInfo.mac) });
  }
  if (deviceInfo.appVersionName) {
    params.push({ name: 'fully_kiosk_version', value: String(deviceInfo.appVersionName) });
  }

  return {
    name,
    external_id: ids.device,
    model: 'Fully Kiosk Browser',
    params,
    features,
  };
}

/**
 * Build the states to publish for an already-created device from a fresh
 * deviceInfo report - only the fields actually present in the payload.
 * @param {object} gladys - The Gladys SDK instance (for externalIds).
 * @param {object} deviceInfo - A normalized deviceInfo (see normalizeDeviceInfo).
 * @returns {Array<object>} The states to pass to gladys.publishStates().
 * @example
 * await gladys.publishStates(buildStatesFromDeviceInfo(gladys, deviceInfo));
 */
export function buildStatesFromDeviceInfo(gladys, deviceInfo) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceInfo.deviceId);
  const states = [];

  if (deviceInfo.batteryLevel !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('battery'),
      state: Number(deviceInfo.batteryLevel),
    });
  }
  if (deviceInfo.isPlugged !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('battery-charging'),
      state: deviceInfo.isPlugged ? 1 : 0,
    });
  }
  if (deviceInfo.screenOn !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('screen'),
      state: deviceInfo.screenOn ? 1 : 0,
    });
  }
  if (deviceInfo.kioskMode !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('kiosk-lock'),
      state: deviceInfo.kioskMode ? 1 : 0,
    });
  }
  if (deviceInfo.currentPage !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('current-page'),
      text: String(deviceInfo.currentPage),
    });
  }

  return states;
}

/**
 * Extract the feature key suffix (the part after the deviceId) from a
 * feature's external_id.
 * @param {string} featureExternalId - The feature external id.
 * @returns {string} The feature key, e.g. 'screen', 'load-url'.
 * @example
 * featureKeyFromExternalId('ext:sel:fullykiosk:abc123:load-url'); // 'load-url'
 */
export function featureKeyFromExternalId(featureExternalId) {
  const parts = featureExternalId.split(':');
  return parts[parts.length - 1];
}

/**
 * Resolve the HTTP target (ip/port/password/useHttps) of a device from the
 * integration config and the device's own params (its IP, learned from
 * MQTT). Throws a descriptive error when the tablet cannot be reached yet -
 * surfaced to the user as the command's failure reason.
 * @param {object} config - The integration config (gladys.config / getConfig()).
 * @param {object} device - The Gladys device (onSetValue/onPoll payload).
 * @returns {{ip: string, port: number, password: string, useHttps: boolean}} The HTTP target.
 * @example
 * const target = resolveHttpTarget(gladys.config, device);
 */
export function resolveHttpTarget(config, device) {
  const ipParam = (device.params || []).find((param) => param.name === 'ip4');
  if (!ipParam || !ipParam.value) {
    throw new Error(
      `no IP known yet for "${device.name}" - waiting for its next MQTT status report`,
    );
  }
  const credential = getTabletCredential(config, device.external_id);
  if (!credential || !credential.password) {
    throw new Error(
      `no REST API password configured for "${device.name}" - use the "Set a tablet's REST API password" action`,
    );
  }
  return {
    ip: ipParam.value,
    port: credential.port || DEFAULT_HTTP_PORT,
    password: credential.password,
    useHttps: !!config[CONFIG_SCHEMA_KEYS.HTTP_USE_HTTPS],
  };
}

/**
 * Apply a command on a device feature by calling the matching Fully Kiosk
 * REST command.
 * @param {import('./FullyKioskClient.js').sendCommand} sendCommand - The REST call function (injected for testability).
 * @param {object} target - `{ ip, port, password, useHttps }`, from resolveHttpTarget.
 * @param {object} feature - The Gladys device feature actioned.
 * @param {number|string} value - The new value.
 * @returns {Promise<void>} Resolves once the command is applied.
 * @example
 * await setDeviceValue(sendCommand, target, feature, 1);
 */
export async function setDeviceValue(sendCommand, target, feature, value) {
  const key = featureKeyFromExternalId(feature.external_id);

  switch (key) {
    case 'screen':
      await sendCommand(target, value ? FULLY_CMD.SCREEN_ON : FULLY_CMD.SCREEN_OFF);
      return;
    case 'kiosk-lock':
      await sendCommand(target, value ? FULLY_CMD.LOCK_KIOSK : FULLY_CMD.UNLOCK_KIOSK);
      return;
    case 'screensaver':
      await sendCommand(target, value ? FULLY_CMD.START_SCREENSAVER : FULLY_CMD.STOP_SCREENSAVER);
      return;
    case 'load-url':
      await sendCommand(target, FULLY_CMD.LOAD_URL, { url: value });
      return;
    case 'text-to-speech':
      await sendCommand(target, FULLY_CMD.TEXT_TO_SPEECH, { text: value });
      return;
    case 'restart-app':
      await sendCommand(target, FULLY_CMD.RESTART_APP);
      return;
    case 'reload-start-url':
      await sendCommand(target, FULLY_CMD.LOAD_START_URL);
      return;
    case 'reboot-device':
      await sendCommand(target, FULLY_CMD.REBOOT_DEVICE);
      return;
    case 'clear-cache':
      await sendCommand(target, FULLY_CMD.CLEAR_CACHE);
      return;
    case 'exit-app':
      await sendCommand(target, FULLY_CMD.EXIT_APP);
      return;
    default:
      throw new Error(`unsupported feature "${key}"`);
  }
}
