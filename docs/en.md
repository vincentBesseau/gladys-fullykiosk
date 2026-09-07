# Fully Kiosk Browser

Discover your [Fully Kiosk Browser](https://www.fully-kiosk.com/) Android
tablets from the status reports they already publish over MQTT (IP address,
battery, current page, kiosk mode...), then control them - screen on/off,
kiosk lock, load a URL, text-to-speech, restart, reboot... - through their
local HTTP REST API.

## How it works

- **Discovery: MQTT.** Fully Kiosk can periodically publish a JSON
  "deviceInfo" report to an MQTT broker (Settings > Other Settings > MQTT
  Settings, in the Fully Kiosk app). This integration connects to that same
  broker and subscribes to everything under a topic prefix (`fully/#` by
  default): any JSON message that looks like a deviceInfo report (it carries
  a device identifier) is picked up, and the tablet appears in Gladys.
- **Control: local HTTP.** Every command (screen on/off, load URL, restart
  app...) is sent straight to the tablet's own REST API
  (`http://<tablet-ip>:2323/?cmd=...`), which Fully Kiosk protects with a
  password set per tablet (Settings > Other Settings > Remote Administration >
  Remote Admin Password). Register that password once the tablet has been
  added to Gladys, using the **Set a tablet's REST API password** action - no
  need to type its IP, pick it from the dropdown.

## MQTT broker: dedicated or existing

The **MQTT broker** configuration field offers two modes:

- **Run a dedicated broker (recommended)**: this integration starts and
  manages its own Mosquitto broker (a sub-container), with an automatically
  generated username and password - nothing else to install. Use the **Show
  managed broker credentials** action (in the Configuration tab) to get the
  address, username and password to enter in each tablet's MQTT settings.
- **Connect to an existing broker**: if you already run an MQTT server
  (Mosquitto, EMQX...), fill in its host/port/credentials in the fields
  provided.

## Configuration

1. Pick a broker mode (above). With the dedicated mode, save the
   configuration once first so the broker starts and its credentials get
   generated, then fetch them with the **Show managed broker credentials**
   action.
2. In each tablet's Fully Kiosk app, enable **MQTT** (Settings > Other
   Settings > MQTT Settings) and point it at the broker address/credentials
   from step 1 - the exact topic you set there does not matter as long as it
   starts with the prefix configured here (`fully` by default).
3. In each tablet's Fully Kiosk app, also enable **Remote Administration**
   (Settings > Other Settings > Remote Administration) and note the **Remote
   Admin Password** you set - Fully Kiosk's REST API needs it for every
   command.
4. Save, then run **Refresh the tablet list** (or open the Discovery tab) once
   a tablet has sent its first MQTT report, and add it to Gladys.
5. Run the **Set a tablet's REST API password** action, pick the tablet from
   the dropdown (only already-added tablets show up there), and enter its
   Remote Admin Password (and a custom REST port, if it isn't the default
   2323). Repeat for each tablet.

## Why an action instead of a config field

Gladys external integrations only expose one flat, integration-wide
configuration form - there is no built-in per-device settings screen. A
manifest **action** can declare its own mini-form, though, including a
dropdown pre-populated with the integration's already-created devices - the
**Set a tablet's REST API password** action uses exactly that, so no one has
to type or copy an IP address by hand. The password is stored keyed by the
tablet's stable Gladys device id, not its IP, so it survives the tablet's
next DHCP lease change unlike an IP-keyed list would.

## Available actions per tablet

| Feature            | Effect                                                          |
| ------------------ | --------------------------------------------------------------- |
| Screen             | Turn the tablet's screen on/off                                 |
| Kiosk lock         | Enable/disable Fully Kiosk's lockdown (kiosk) mode              |
| Screensaver        | Start/stop the screensaver                                      |
| Current page       | Read-only: the URL/app currently in the foreground              |
| Load URL           | Write a URL to load it immediately                              |
| Text to speech     | Write text to have the tablet speak it                          |
| Restart app        | Restart the Fully Kiosk app                                     |
| Reload start URL   | Reload the configured start URL                                 |
| Reboot device      | Reboot the whole tablet (requires Device Owner/root on Android) |
| Clear cache        | Clear the browser cache                                         |
| Exit app           | Exit the Fully Kiosk app                                        |
| Battery / Charging | Read-only, when reported by the tablet                          |

## Limitations

- Local network only: no cloud account, nothing works if the tablet or the
  MQTT broker is unreachable.
- The "Set a tablet's REST API password" action shows the password in clear
  while you type it - Gladys does not mask `secret`-type fields inside an
  action's own form (only in the main Configuration form), so this
  integration uses a plain field there instead of a broken masked one. The
  value is still stored securely server-side and never displayed again
  afterwards.
- Managed broker mode publishes the broker's port on your Gladys server's
  LAN - anyone on that network who has the generated credentials can connect
  to it. Fine for a home LAN, worth knowing on a shared/untrusted network.
- The managed broker's password file has to be world-readable (Gladys runs
  every sub-container with all Linux capabilities dropped, so this
  integration cannot `chown` it to the broker's own user) - Mosquitto 2.0.18
  only warns about this; a future Mosquitto version may refuse to start
  under that condition, which would need this integration's pinned
  Mosquitto image tag to be revisited.
- No live push for commands' effect: the dashboard reflects a tablet's real
  state only after its next scheduled MQTT report (or a manual poll).
- Fully Kiosk's exact MQTT/REST field names have drifted across app versions
  and are not formally versioned; if a field (e.g. current page) never
  populates, check the raw payload (logged at debug level,
  `LOG_LEVEL=debug`) against your Fully Kiosk version.
- "Reboot device" and some settings commands require the tablet to be a
  Device Owner (or rooted) - otherwise Fully Kiosk rejects the command,
  independently of this integration.
