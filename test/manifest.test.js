// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIG_SCHEMA_KEYS,
  SET_TABLET_PASSWORD_FIELDS,
  DEFAULT_MQTT_TOPIC_PREFIX,
} from '../src/constants.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('manifest description is 10-100 characters in every declared language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} is ${text.length} chars`,
    );
  }
});

test('every declared config field key is used by the code', () => {
  const declaredKeys = manifest.config_schema
    .filter((field) => field.type !== 'section')
    .map((field) => field.key);
  const usedKeys = Object.values(CONFIG_SCHEMA_KEYS);
  for (const key of declaredKeys) {
    assert.ok(usedKeys.includes(key), `manifest config key "${key}" is not read by the code`);
  }
});

test('the manifest topic prefix default matches the code default', () => {
  const field = manifest.config_schema.find((f) => f.key === CONFIG_SCHEMA_KEYS.MQTT_TOPIC_PREFIX);
  assert.equal(field.default, DEFAULT_MQTT_TOPIC_PREFIX);
});

test('every manifest action has a registered handler', () => {
  // Kept in sync by hand with index.js's gladys.onAction(...) calls.
  const handled = new Set(['scan_now', 'show_broker_credentials', 'set_tablet_password']);
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
  }
});

test('set_tablet_password lets the user pick an already-created device, no IP typing', () => {
  const action = manifest.actions.find((a) => a.key === 'set_tablet_password');
  assert.ok(action, 'manifest must declare a "set_tablet_password" action');

  const deviceField = action.fields.find((f) => f.key === SET_TABLET_PASSWORD_FIELDS.DEVICE);
  assert.ok(deviceField, 'set_tablet_password must have a "device" field');
  assert.equal(deviceField.type, 'select');
  assert.equal(deviceField.source, 'devices');

  const passwordField = action.fields.find((f) => f.key === SET_TABLET_PASSWORD_FIELDS.PASSWORD);
  assert.ok(passwordField, 'set_tablet_password must have a "password" field');
  assert.equal(passwordField.type, 'secret');
});

test('the managed broker sub-container matches the code constants', () => {
  const container = manifest.containers.find((c) => c.name === 'mosquitto');
  assert.ok(container, 'manifest must declare the "mosquitto" sub-container');
  assert.equal(container.start, 'manual');
  const mqttPort = container.ports.find((p) => p.container_port === 1883);
  assert.ok(mqttPort, 'the mosquitto sub-container must publish port 1883');
});

test('the broker_mode field declares "managed" and "external" options', () => {
  const field = manifest.config_schema.find((f) => f.key === CONFIG_SCHEMA_KEYS.BROKER_MODE);
  assert.ok(field, 'manifest must declare a broker_mode field');
  const values = field.options.map((o) => o.value);
  assert.deepEqual(values.sort(), ['external', 'managed']);
  assert.equal(field.default, 'managed');
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('this integration declares no cloud transport (LAN-only control)', () => {
  assert.deepEqual(manifest.transports, ['local']);
});
