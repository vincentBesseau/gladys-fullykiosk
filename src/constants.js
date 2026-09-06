// -----------------------------------------------------------------------------
// Fully Kiosk Browser integration constants.
//
// Field names used to read the MQTT/HTTP deviceInfo payload (see
// normalizeDeviceInfo in devices.js) come from Fully Kiosk's own public REST
// & MQTT documentation (https://www.fully-kiosk.com/en/#rest,
// https://www.fully-kiosk.com/en/#mqtt) as of writing. Fully Kiosk does not
// publish a versioned schema for this payload, so parsing stays defensive
// (every field is read with `'key' in payload`, several candidate keys are
// tried where the casing is unclear) - a field that never populates is more
// likely a naming mismatch with a given Fully Kiosk version than a bug; check
// the raw payload logged at debug level first.
// -----------------------------------------------------------------------------

export const DEVICE_TYPE = 'fullykiosk';

// Config keys DECLARED in the config_schema (typed by the user in the UI).
export const CONFIG_SCHEMA_KEYS = {
  MQTT_HOST: 'mqtt_host',
  MQTT_PORT: 'mqtt_port',
  MQTT_USE_TLS: 'mqtt_use_tls',
  MQTT_USERNAME: 'mqtt_username',
  MQTT_PASSWORD: 'mqtt_password',
  MQTT_TOPIC_PREFIX: 'mqtt_topic_prefix',
  HTTP_USE_HTTPS: 'http_use_https',
  TABLETS: 'tablets',
};

export const DEFAULT_MQTT_PORT = 1883;
export const DEFAULT_MQTT_TOPIC_PREFIX = 'fully';
export const DEFAULT_HTTP_PORT = 2323;

// Fully Kiosk's own REST server can be slow to answer while the tablet is
// asleep/under load - long enough to cover that, short enough to not hang a
// Gladys scene forever on an unreachable tablet.
export const FULLY_KIOSK_REST_TIMEOUT_MS = 10 * 1000;

// Fully Kiosk REST API commands this integration exposes as device features
// (`?cmd=<value>`, see https://www.fully-kiosk.com/en/#rest).
export const FULLY_CMD = {
  DEVICE_INFO: 'deviceInfo',
  SCREEN_ON: 'screenOn',
  SCREEN_OFF: 'screenOff',
  LOCK_KIOSK: 'lockKiosk',
  UNLOCK_KIOSK: 'unlockKiosk',
  START_SCREENSAVER: 'startScreensaver',
  STOP_SCREENSAVER: 'stopScreensaver',
  RESTART_APP: 'restartApp',
  EXIT_APP: 'exitApp',
  REBOOT_DEVICE: 'rebootDevice',
  CLEAR_CACHE: 'clearCache',
  LOAD_START_URL: 'loadStartUrl',
  LOAD_URL: 'loadUrl',
  TEXT_TO_SPEECH: 'textToSpeech',
};

// Debounce for re-publishing the full discovered-device list after a burst of
// MQTT messages (e.g. every tablet reporting at once on broker reconnect).
export const REPUBLISH_DEBOUNCE_MS = 2 * 1000;
