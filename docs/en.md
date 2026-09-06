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
  Remote Admin Password). Enter that password for each tablet in this
  integration's configuration.

## Configuration

1. In each tablet's Fully Kiosk app, enable **MQTT** (Settings > Other
   Settings > MQTT Settings) and point it at the same broker you will enter
   below - the exact topic you set there does not matter as long as it starts
   with the prefix configured here (`fully` by default).
2. In each tablet's Fully Kiosk app, also enable **Remote Administration**
   (Settings > Other Settings > Remote Administration) and note the **Remote
   Admin Password** you set - Fully Kiosk's REST API needs it for every
   command.
3. Open this integration's **Configuration** tab and fill in your MQTT broker
   (host, port, credentials if any).
4. In the **Tablets** field, add one line per tablet: `ip:password` (or
   `ip:port:password` if a tablet's REST port isn't the default 2323). The IP
   must match the one the tablet reports over MQTT - a static DHCP
   reservation for each tablet is recommended.
5. Save, then run **Refresh the tablet list** (or open the Discovery tab) once
   a tablet has sent its first MQTT report.

## Why not a per-tablet setting screen

Gladys external integrations only expose one flat, integration-wide
configuration form - there is no per-device settings screen a user can fill
in. The **Tablets** field above (one `ip:password` line per tablet) is the
closest available substitute, the same pattern `gladys-sonos`'s "Known IPs"
field uses for per-target data.

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
- No live push for commands' effect: the dashboard reflects a tablet's real
  state only after its next scheduled MQTT report (or a manual poll).
- Fully Kiosk's exact MQTT/REST field names have drifted across app versions
  and are not formally versioned; if a field (e.g. current page) never
  populates, check the raw payload (logged at debug level,
  `LOG_LEVEL=debug`) against your Fully Kiosk version.
- "Reboot device" and some settings commands require the tablet to be a
  Device Owner (or rooted) - otherwise Fully Kiosk rejects the command,
  independently of this integration.
