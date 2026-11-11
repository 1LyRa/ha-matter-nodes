# Changelog

## 1.5.1

- **Official Matter Sidebar Icon**: Updated `panel_icon: "mdi:matter"` in Home Assistant configuration to display the official Matter logo on the sidebar instead of a generic cube icon.
- **Top-Right Logs Button**: Moved the live logs viewer toggle to the top-right header next to status badges and theme controls, keeping entity filter tabs strictly focused on device domains.
- **In-Viewer Dismiss**: Added a quick close button inside the logs header to dismiss the logs viewer and return directly to the devices grid.
- **Repository Cleanup**: Removed internal development files, archived temporary icon design assets, purged legacy Hyper-V references, and modernized documentation to focus purely on Home Assistant Add-on Store installation.

## 1.5.0

- **Dedicated On/Off Button for AC / Climate in Google Home**: Extended the Thermostat endpoint with Matter `OnOffServer`. Google Home now displays a dedicated power toggle button directly on the AC/thermostat card and detail screen, controlling `climate.turn_on` and `climate.turn_off` (with fallback to `set_hvac_mode`).
- **Fan Speed & Fan Mode Control for ACs**: Extended climate endpoints with Matter `FanControlServer` (`MultiSpeed` and `Auto`). Google Home now exposes fan speed percentages, speed steps, and mode selectors (Low, Medium, High, Auto), dynamically mapped and synchronized to Home Assistant's `climate.set_fan_mode`.
- **Collapsible Pairing Information for Paired Devices**: Already commissioned devices now hide the large QR code and manual pairing code by default to keep the dashboard tidy, replacing them with a compact "Active in Google Home Fabric" status and an on-demand "📱 Show Pairing QR & Code" expand toggle.
- **Persistent Basic Information Sync**: Automatically syncs `nodeLabel` and `productName` attributes in node persistent storage on every startup, ensuring newly commissioned devices always provide their Home Assistant friendly name to Google Home.
- **Multi-Arch GitHub Actions Builder Workflow**: Added `.github/workflows/publish.yaml` targeting `ghcr.io` via official Home Assistant Builder (`home-assistant/builder`), allowing pre-built multi-arch images (`amd64`, `aarch64`) with native layer download progress bars in Home Assistant during installation and updates.

## 1.4.2

- **Live Logs Viewer**: Added an integrated "Logs" tab directly in the dashboard with live auto-scroll, color-coded level badges (INFO, WARN, ERROR, DEBUG), one-click clipboard copy, and buffer clearing.
- **In-Memory Ring Logger**: Lightweight FIFO buffer streaming all Node.js, Matter.js, and WebSocket communication logs without disk I/O overhead.
- **Matter Server Style Icon (Black on White)**: Updated add-on branding to a high-contrast black-on-white base Matter logo with standalone multi-node satellite accents, styled in harmony with the official Home Assistant Matter Server logo.

## 1.4.1

- **Fix Light Color Temperature**: Resolved `invalid_format: not a valid option, did you mean 'color_temp_kelvin'?` when adjusting color temperature from Google Home. Migrated service payload from deprecated `color_temp` to Home Assistant's modern `color_temp_kelvin` with bidirectional mireds/Kelvin translation.
- **Tailored for Google Home**: Clarified throughout documentation and configuration that this add-on is designed and optimized specifically for Google Home to bypass Matter bridge limitations (not intended for Apple Home or Alexa).
- **Dashboard Kelvin Display**: Updated dashboard light metrics to display temperature in Kelvin (`K`).

## 1.4.0

- **AC & Thermostat Support (`climate.*`)**: Exposes Home Assistant climate entities as standalone Matter `ThermostatDevice` accessories directly to Google Home and Apple Home.
  - **HVAC Modes**: Full bidirectional synchronization for `off`, `cool`, `heat`, and `auto` modes.
  - **Single & Dual Setpoint Sync**: Synchronizes target temperatures, heating/cooling setpoints, and deadbands conforming to Matter specification bounds.
  - **Ambient Temperature Reporting**: Live room temperature measurement and unit conversion (°C and °F).
  - **Service Dispatch**: Debounced bidirectional service calling for `climate.set_temperature` and `climate.set_hvac_mode`.
- **Web Dashboard Climate Tab**: Added dedicated "Climate" filter tab, live temperature and setpoint metric cards, HVAC mode indicators, and quick power toggles.
- **Defensive Node Allocation**: Added fallback safety defaults for sequential UDP ports and commissioning discriminators.

## 1.3.0

- **Exact Device Naming in Google Home & Apple Home**: Injects Home Assistant entity friendly names into Matter's `BasicInformation` (`nodeLabel`, `productName`, `productLabel`, `vendorName`) so controllers automatically name devices after HA instead of falling back to generic names.
- **Dynamic Name Updates**: Automatically updates Matter `nodeLabel` and `productName` if a device's friendly name changes in Home Assistant.
- **Lights Support**: Full bidirectional support for `light.*` entities:
  - On/Off Lights (`OnOffLightDevice`)
  - Dimmable Lights (`DimmableLightDevice` with smooth 0–255 to 1–254 brightness sync)
  - Color Temperature Lights (`ColorTemperatureLightDevice` with Mireds and Kelvin support)
  - Full Color Lights (`ExtendedColorLightDevice` with CIE 1931 XY coordinates)
- **Web Dashboard Lights Tab**: Added "Lights" filter tab and brightness badges in the Ingress interface.

## 1.2.0

- **Sensors Support**: Added full support for Temperature, Humidity, and Battery sensors.
- **Smart Sensor Grouping**: Automatically groups composite multi-sensor entities (e.g. `_temperature`, `_humidity`, `_battery`) into a single unified Matter device node with 1 QR code.
- **Real-Time Sensor Sync**: Converts temperature (Celsius/Fahrenheit), relative humidity, and battery percent to Matter cluster specifications in real time.
- **Filter Tabs**: Added quick tabs for "All", "Switches", "Sensors", "Active", and "Unannounced".
- **Documentation Cleanup**: Cleaned up README and documentation to focus entirely on Home Assistant Add-on operation.

## 1.1.0

- **Theme System**: Added Light, Dark, and Auto theme switcher matching the Home Assistant design system (persisted in local storage).
- **On-Demand Matter Announcement**: Disabled announcing by default to keep the local network quiet and UDP ports free.
- **Per-Device Activation**: Added "Announce as Matter Device" button to explicitly publish Matter mDNS and QR codes on demand.
- **Port Management**: Dynamically allocates and reserves sequential UDP ports starting at 5541.
- **Filter Tabs**: Added quick tabs for "All Switches", "Active Matter", and "Unannounced".
- **Persistent State**: Saved enabled devices and allocated ports in `/data/matter/enabled_entities.json`.

## 1.0.0

- Initial release.
- Exposes Home Assistant switches as individual standalone Matter accessories (`OnOffPlugInUnitDevice`) starting at UDP port 5541 to bypass Google Home Matter bridge bugs.
- Embedded Ingress dashboard with high-contrast QR codes and 11-digit manual pairing codes.
- Real-time bidirectional state sync with Home Assistant over WebSocket.
