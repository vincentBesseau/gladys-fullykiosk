import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  parseTabletCredentials,
  getTabletCredential,
  setTabletCredential,
} from '../src/tabletCredentials.js';

describe('parseTabletCredentials', () => {
  test('parses a stored JSON blob', () => {
    const parsed = parseTabletCredentials('{"ext:sel:fullykiosk:abc":{"password":"secret"}}');
    assert.deepEqual(parsed, { 'ext:sel:fullykiosk:abc': { password: 'secret' } });
  });

  test('returns an empty object for empty/invalid/non-object input', () => {
    assert.deepEqual(parseTabletCredentials(undefined), {});
    assert.deepEqual(parseTabletCredentials(''), {});
    assert.deepEqual(parseTabletCredentials('not json'), {});
    assert.deepEqual(parseTabletCredentials('[1,2,3]'), {});
  });
});

describe('getTabletCredential', () => {
  test('reads one device credential out of the stored map', () => {
    const config = {
      tablet_credentials_json: JSON.stringify({
        'ext:sel:fullykiosk:abc': { password: 'secret', port: 8080 },
      }),
    };
    assert.deepEqual(getTabletCredential(config, 'ext:sel:fullykiosk:abc'), {
      password: 'secret',
      port: 8080,
    });
  });

  test('returns undefined when the device has no stored credential', () => {
    assert.equal(getTabletCredential({}, 'ext:sel:fullykiosk:abc'), undefined);
  });
});

describe('setTabletCredential', () => {
  test('persists a new credential', async () => {
    const gladys = createFakeGladys();
    await setTabletCredential(gladys, 'ext:sel:fullykiosk:abc', { password: 'secret' });

    const config = await gladys.getConfig();
    assert.deepEqual(getTabletCredential(config, 'ext:sel:fullykiosk:abc'), {
      password: 'secret',
    });
  });

  test('merges with existing credentials of other devices', async () => {
    const gladys = createFakeGladys({
      config: {
        tablet_credentials_json: JSON.stringify({
          'ext:sel:fullykiosk:existing': { password: 'old' },
        }),
      },
    });

    await setTabletCredential(gladys, 'ext:sel:fullykiosk:new', { password: 'new-secret' });

    const config = await gladys.getConfig();
    assert.deepEqual(getTabletCredential(config, 'ext:sel:fullykiosk:existing'), {
      password: 'old',
    });
    assert.deepEqual(getTabletCredential(config, 'ext:sel:fullykiosk:new'), {
      password: 'new-secret',
    });
  });

  test('overwrites a previous credential for the same device', async () => {
    const gladys = createFakeGladys();
    await setTabletCredential(gladys, 'ext:sel:fullykiosk:abc', { password: 'old' });
    await setTabletCredential(gladys, 'ext:sel:fullykiosk:abc', { password: 'new', port: 9000 });

    const config = await gladys.getConfig();
    assert.deepEqual(getTabletCredential(config, 'ext:sel:fullykiosk:abc'), {
      password: 'new',
      port: 9000,
    });
  });
});
