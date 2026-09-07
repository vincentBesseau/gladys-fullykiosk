# gladys-fullykiosk

[![Latest version](https://img.shields.io/github/v/tag/vincentBesseau/gladys-fullykiosk?label=version)](https://github.com/vincentBesseau/gladys-fullykiosk/tags)
[![CI](https://github.com/vincentBesseau/gladys-fullykiosk/actions/workflows/ci.yml/badge.svg)](https://github.com/vincentBesseau/gladys-fullykiosk/actions/workflows/ci.yml)
[![Docker pulls](https://ghcr-badge.elias.eu.org/shield/vincentBesseau/gladys-fullykiosk/gladys-fullykiosk)](https://github.com/vincentBesseau/gladys-fullykiosk/pkgs/container/gladys-fullykiosk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://www.apache.org/licenses/LICENSE-2.0)
[![Gladys](https://img.shields.io/badge/gladys-%3E%3D4.86.0-6f42c1)](https://gladysassistant.com)

External [Gladys Assistant](https://gladysassistant.com) integration to discover **Fully Kiosk Browser** Android tablets — over MQTT (Fully Kiosk PLUS) or by IP (free edition) — and control them through their local HTTP REST API — see [`docs/en.md`](./docs/en.md) for full setup.

Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js), from the [official template](https://github.com/GladysAssistant/integration-template-js). MQTT connectivity is [`mqtt.js`](https://github.com/mqttjs/MQTT.js); HTTP calls use Node's global `fetch` — no other runtime dependency.

## What it does

| Feature                                                                 | Notes                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery (MQTT)                                                        | Passive — reads the JSON "deviceInfo" reports Fully Kiosk already publishes over MQTT (IP, battery, current page, kiosk mode...); requires Fully Kiosk PLUS |
| Discovery (IP)                                                          | "Add a tablet by IP" action — queries the tablet's REST API directly, no MQTT/PLUS license needed, see `docs/en.md`                                         |
| **Managed MQTT broker**                                                 | Optional: this integration can run its own Mosquitto sub-container with generated credentials — no separate broker required, see `docs/en.md`               |
| Screen / Kiosk lock / Screensaver                                       | On/off switches, sent as Fully Kiosk REST commands                                                                                                          |
| Load URL / Text to speech                                               | Free-text features: write a value, the tablet acts on it immediately                                                                                        |
| Restart app / Reload start URL / Reboot device / Clear cache / Exit app | One-click button features                                                                                                                                   |
| Battery / Charging                                                      | Read-only, when reported                                                                                                                                    |
| **Tablets**                                                             | Per-tablet REST API password set via the "Set a tablet's REST API password" action — a device dropdown, no IP to type, see `docs/en.md`                     |

No cloud account: MQTT broker and tablets are reached directly over the local network.

## Architecture

```
index.js                    SDK + MQTT wiring: handlers, discovery cache, manifest actions
src/FullyKioskClient.js      Fully Kiosk REST client (sendCommand, getDeviceInfo)
src/devices.js               deviceInfo normalization, Gladys device/feature conversion, command dispatch
src/managedBroker.js         Managed-broker credential generation/persistence, sub-container port lookup
src/tabletCredentials.js     Per-tablet REST API credentials (set via the "set_tablet_password" action)
src/constants.js             config keys, REST commands, defaults
```

## Local development

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="fullykiosk" \
npm start
```

```bash
npm test          # unit tests (node --test)
npm run lint      # eslint
npm run format    # prettier
```

## License

Apache-2.0
