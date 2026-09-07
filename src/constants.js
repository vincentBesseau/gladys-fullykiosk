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
  BROKER_MODE: 'broker_mode',
  MQTT_HOST: 'mqtt_host',
  MQTT_PORT: 'mqtt_port',
  MQTT_USE_TLS: 'mqtt_use_tls',
  MQTT_USERNAME: 'mqtt_username',
  MQTT_PASSWORD: 'mqtt_password',
  MQTT_TOPIC_PREFIX: 'mqtt_topic_prefix',
  HTTP_USE_HTTPS: 'http_use_https',
};

// Fields of the "set_tablet_password" manifest action (contract C.1: action
// fields use the config_schema field format, including `select` with
// `source: "devices"` - populated by Gladys with the integration's
// already-created devices, no IP typing required).
export const SET_TABLET_PASSWORD_FIELDS = {
  DEVICE: 'device',
  PASSWORD: 'password',
  PORT: 'port',
};

// Fields of the "add_tablet_by_ip" manifest action - the alternative to MQTT
// discovery for a tablet running Fully Kiosk's free (non-PLUS) edition, which
// cannot publish MQTT deviceInfo reports at all. Queries the tablet's REST
// API directly (deviceInfo command), so it also doubles as a password check.
export const ADD_TABLET_BY_IP_FIELDS = {
  IP: 'ip',
  PASSWORD: 'password',
  PORT: 'port',
};

// Config keys stored OUTSIDE the config_schema (never shown in the standard
// form) - the external equivalent of the core's gladys.variable.
export const CONFIG_KEYS = {
  // Generated managed-broker credentials - see src/managedBroker.js.
  MANAGED_BROKER_USERNAME: 'managed_broker_username',
  MANAGED_BROKER_PASSWORD: 'managed_broker_password',
  // Per-tablet REST API credentials, set via the "set_tablet_password"
  // action - see src/tabletCredentials.js. Stored as a JSON string: a map of
  // device external_id -> { password, port }.
  TABLET_CREDENTIALS: 'tablet_credentials_json',
};

// Values of the `broker_mode` config field.
export const BROKER_MODE = {
  // This integration runs its own Mosquitto broker as a manifest
  // sub-container (see `containers` in gladys-assistant-integration.json) -
  // no separate MQTT server required from the user.
  MANAGED: 'managed',
  // The user already has an MQTT broker and provides its connection details
  // (mqtt_host/mqtt_port/...).
  EXTERNAL: 'external',
};

// The managed broker sub-container: name (also its DNS alias on the
// integration's private Docker network, reachable from THIS container), and
// the MQTT port it listens on internally (the host port it gets published on
// is assigned by Gladys - see findManagedBrokerHostPort in managedBroker.js).
export const MANAGED_BROKER = {
  CONTAINER_NAME: 'mosquitto',
  CONTAINER_PORT: 1883,
};

export const DEFAULT_MQTT_PORT = 1883;
export const DEFAULT_MQTT_TOPIC_PREFIX = 'fully';
export const DEFAULT_HTTP_PORT = 2323;

// How often Gladys itself calls onPoll (HTTP fallback, see index.js) for
// each tablet. Fully Kiosk's own periodic MQTT report does not necessarily
// carry every field (e.g. "current page" was observed missing from it,
// present in the full HTTP deviceInfo response) - polling is this
// integration's only way to keep those fields fresh, not just a startup
// fallback. Gladys' device.poll_frequency is NOT an arbitrary duration: the
// core rejects any value outside its own DEVICE_POLL_FREQUENCIES enum
// (server/utils/constants.js), whose slowest option is "every minute" -
// confirmed live (a longer value throws "invalid poll frequency" and the
// whole discovered-device publish is rejected). This is the max Gladys will
// ever call onPoll at.
export const GLADYS_POLL_FREQUENCY_IN_MS = 60 * 1000;

// Actual desired cadence for the HTTP request this integration makes to a
// tablet - slower than GLADYS_POLL_FREQUENCY_IN_MS, since a kiosk's
// foreground page does not need minute-by-minute freshness. Gladys cannot be
// told to call onPoll this infrequently (see above), so onPoll is invoked
// every GLADYS_POLL_FREQUENCY_IN_MS as usual but only actually acts once
// this much time has passed since the tablet's last real poll (per-device
// throttle, see shouldPoll in src/devices.js).
export const HTTP_POLL_INTERVAL_MS = 10 * 60 * 1000;

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
