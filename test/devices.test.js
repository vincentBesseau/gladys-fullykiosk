import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  normalizeDeviceInfo,
  convertToGladysDevice,
  buildStatesFromDeviceInfo,
  resolveHttpTarget,
  setDeviceValue,
  featureKeyFromExternalId,
} from '../src/devices.js';

describe('normalizeDeviceInfo', () => {
  test('reads the standard field names', () => {
    const info = normalizeDeviceInfo({
      deviceId: 'abc123',
      deviceName: 'Kitchen tablet',
      ip4: '192.168.1.50',
      batteryLevel: 87,
      isPlugged: true,
      screenOn: true,
      kioskMode: true,
      currentPage: 'https://example.com',
    });
    assert.equal(info.deviceId, 'abc123');
    assert.equal(info.deviceName, 'Kitchen tablet');
    assert.equal(info.ip4, '192.168.1.50');
    assert.equal(info.batteryLevel, 87);
    assert.equal(info.isPlugged, true);
  });

  test('falls back to alternate key casings', () => {
    const info = normalizeDeviceInfo({ deviceID: 'abc123', ip4Address: '192.168.1.50' });
    assert.equal(info.deviceId, 'abc123');
    assert.equal(info.ip4, '192.168.1.50');
  });

  test('returns null when no device identifier is present', () => {
    assert.equal(normalizeDeviceInfo({ batteryLevel: 87 }), null);
    assert.equal(normalizeDeviceInfo(null), null);
    assert.equal(normalizeDeviceInfo('not an object'), null);
  });
});

describe('convertToGladysDevice', () => {
  const gladys = createFakeGladys();

  test('builds the always-present features and params', () => {
    const device = convertToGladysDevice(
      gladys,
      normalizeDeviceInfo({
        deviceId: 'abc123',
        deviceName: 'Kitchen tablet',
        ip4: '192.168.1.50',
      }),
    );
    assert.equal(device.name, 'Kitchen tablet');
    assert.equal(device.external_id, 'fullykiosk:abc123');
    assert.deepEqual(device.params, [{ name: 'ip4', value: '192.168.1.50' }]);

    const keys = device.features.map((f) => f.external_id.split(':').pop());
    for (const expected of [
      'screen',
      'kiosk-lock',
      'screensaver',
      'current-page',
      'load-url',
      'text-to-speech',
      'restart-app',
      'reload-start-url',
      'reboot-device',
      'clear-cache',
      'exit-app',
    ]) {
      assert.ok(keys.includes(expected), `missing feature "${expected}"`);
    }
    assert.ok(!keys.includes('battery'), 'battery feature should be omitted when unknown');
  });

  test('adds the battery features only when reported', () => {
    const device = convertToGladysDevice(
      gladys,
      normalizeDeviceInfo({ deviceId: 'abc123', batteryLevel: 55, isPlugged: false }),
    );
    const battery = device.features.find((f) => f.external_id.endsWith(':battery'));
    const charging = device.features.find((f) => f.external_id.endsWith(':battery-charging'));
    assert.ok(battery);
    assert.ok(charging);
  });

  test('falls back to a generated name when deviceName is missing', () => {
    const device = convertToGladysDevice(gladys, normalizeDeviceInfo({ deviceId: 'abc123' }));
    assert.equal(device.name, 'Fully Kiosk abc123');
  });

  test('every feature declares a non-null min/max (Gladys rejects the device otherwise)', () => {
    const device = convertToGladysDevice(
      gladys,
      normalizeDeviceInfo({ deviceId: 'abc123', batteryLevel: 55, isPlugged: false }),
    );
    for (const feature of device.features) {
      assert.notEqual(feature.min, undefined, `${feature.name}: min is missing`);
      assert.notEqual(feature.max, undefined, `${feature.name}: max is missing`);
    }
  });
});

describe('buildStatesFromDeviceInfo', () => {
  test('only publishes the fields actually present', () => {
    const gladys = createFakeGladys();
    const states = buildStatesFromDeviceInfo(
      gladys,
      normalizeDeviceInfo({ deviceId: 'abc123', batteryLevel: 42, screenOn: false }),
    );
    assert.deepEqual(
      states.sort((a, b) =>
        a.device_feature_external_id.localeCompare(b.device_feature_external_id),
      ),
      [
        { device_feature_external_id: 'fullykiosk:abc123:battery', state: 42 },
        { device_feature_external_id: 'fullykiosk:abc123:screen', state: 0 },
      ],
    );
  });
});

describe('featureKeyFromExternalId', () => {
  test('extracts the trailing feature key', () => {
    assert.equal(featureKeyFromExternalId('ext:sel:fullykiosk:abc123:load-url'), 'load-url');
  });
});

describe('resolveHttpTarget', () => {
  const device = {
    name: 'Kitchen tablet',
    external_id: 'ext:sel:fullykiosk:abc123',
    params: [{ name: 'ip4', value: '192.168.1.50' }],
  };
  const configWith = (credential, extra = {}) => ({
    tablet_credentials_json: JSON.stringify({ [device.external_id]: credential }),
    ...extra,
  });

  test('resolves ip/port/password from the stored per-device credential', () => {
    const target = resolveHttpTarget(configWith({ password: 'secret', port: 8080 }), device);
    assert.deepEqual(target, {
      ip: '192.168.1.50',
      port: 8080,
      password: 'secret',
      useHttps: false,
    });
  });

  test('falls back to the default REST port when none is stored', () => {
    const target = resolveHttpTarget(configWith({ password: 'secret' }), device);
    assert.equal(target.port, 2323);
  });

  test('honors the global https toggle', () => {
    const target = resolveHttpTarget(
      configWith({ password: 'secret' }, { http_use_https: true }),
      device,
    );
    assert.equal(target.useHttps, true);
  });

  test('throws when the device has no known IP yet', () => {
    assert.throws(() => resolveHttpTarget({}, { name: 'x', params: [] }), /no IP known/);
  });

  test('throws when no password is configured for this device', () => {
    assert.throws(() => resolveHttpTarget({}, device), /no REST API password/);
  });
});

describe('setDeviceValue', () => {
  const target = { ip: '192.168.1.50', port: 2323, password: 'secret', useHttps: false };

  test('dispatches screen on/off', async () => {
    const calls = [];
    const fakeSendCommand = async (t, cmd, params) => calls.push({ t, cmd, params });

    await setDeviceValue(fakeSendCommand, target, { external_id: 'x:screen' }, 1);
    await setDeviceValue(fakeSendCommand, target, { external_id: 'x:screen' }, 0);

    assert.equal(calls[0].cmd, 'screenOn');
    assert.equal(calls[1].cmd, 'screenOff');
  });

  test('dispatches load-url with the url parameter', async () => {
    const calls = [];
    const fakeSendCommand = async (t, cmd, params) => calls.push({ cmd, params });

    await setDeviceValue(
      fakeSendCommand,
      target,
      { external_id: 'x:load-url' },
      'https://example.com',
    );

    assert.equal(calls[0].cmd, 'loadUrl');
    assert.deepEqual(calls[0].params, { url: 'https://example.com' });
  });

  test('dispatches button features regardless of value', async () => {
    const calls = [];
    const fakeSendCommand = async (t, cmd) => calls.push(cmd);

    await setDeviceValue(fakeSendCommand, target, { external_id: 'x:restart-app' }, 1);
    assert.equal(calls[0], 'restartApp');
  });

  test('throws on an unsupported feature key', async () => {
    await assert.rejects(
      setDeviceValue(async () => {}, target, { external_id: 'x:unknown' }, 1),
      /unsupported feature/,
    );
  });
});
