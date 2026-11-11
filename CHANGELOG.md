# Changelog

## 1.6.0

- **Logical Fan Speed Sorting**: Fixed fan speed percentage mapping for ACs and fan entities whose Home Assistant options are in alphabetical order (e.g. `["High", "Low", "Mid", "Mid High", "Mid Low", "Mute", "Turbo"]`). Speeds are now ranked and sorted logically from quietest to fastest (`Mute` $\rightarrow$ `Low` $\rightarrow$ `Mid Low` $\rightarrow$ `Mid` $\rightarrow$ `Mid High` $\rightarrow$ `High` $\rightarrow$ `Turbo`), preventing low percentages from setting High and high percentages from setting Mute.

## 1.5.9

- **Multi-Channel Light Grouping**: Automatically detects multi-gang wall switches and multi-channel light fixtures (e.g. Aqara Smart Wall Switch Light 1 & Light 2, RFSAI dual lights) and groups them into a single physical Matter device with independent Matter endpoints.
- **Multi-Channel Dashboard Controls**: Dashboard cards for multi-channel lights now display each channel's name, live state indicator, and discrete toggle controls directly in the web UI.
- **Resilient AC Fan Speed Routing**: Intelligently inspects Home Assistant climate entities for fan control support (`ClimateEntityFeature.FAN_MODE`). If the climate entity does not natively accept `climate.set_fan_mode`, fan speed and percentage adjustments from Google Home are seamlessly dispatched to companion fan entities (`fan.*`), companion selects (`select.*`), or climate preset modes (`low`, `medium`, `high`), preventing `ServiceValidationError` crashes.
- **Fountain & Pump Preservation & Name Deduplication**: Ensures fountains/pumps with `raw_power` in their entity ID (e.g. `switch.bedroom_fountain_new_bedroom_fountain_raw_power`) are recognized as primary pump devices and never erroneously hidden as auxiliary switches. Automatically deduplicates repetitive integration naming patterns (e.g. "Bedroom fountain Bedroom fountain raw power" -> "Bedroom fountain", "Air conditioner Air conditioner" -> "Air conditioner").
- **Exclusion of Battery-Only Diagnostic Entities & Vacuum Helpers**: Strictly suppresses mobile phone battery sensors (`sensor.pixel_8_battery_level`), robot vacuum battery and auxiliary switches (`switch.roomba_prime_pad_dry`, `switch.roomba_schedule_*`, `input_boolean.roomba_*_light_owned`), and door/window contact sensor battery indicators from generating empty "Multi-Sensor" cards. Multi-sensor qualification now requires at least one primary environmental measurement (temperature, humidity, or occupancy).

## 1.5.8

- **Unified Single-Entity Climate & AC**: Removed the secondary composed `FanDevice` endpoint (Endpoint 2). Because Google Home natively maps and displays fan speed sliders, percentage controls, and Auto/Low/Medium/High modes directly on the primary AC page via Endpoint 1's `FanControlServer`, removing Endpoint 2 prevents Google Home from generating an unwanted separate standalone "Fan" tile in the room. All fan controls, on/off toggles, and temperature controls now live unified inside the single AC card.

## 1.5.7

- **Child & Auxiliary Entity Suppression**: Automatically identifies and hides secondary configuration controls, child switches, and diagnostic entities from the main device grid. Entities matching child lock (`_child_lock`), alarm controls (`_audible_alarm_enabled`, `_visual_alarm_enabled`, `_alarm_enabled`), direct power toggles (`_raw_power`), LED indicators (`_indicator_light`, `_status_led`, `_led`), and sensor device configuration switches are grouped under their parent device and hidden by default unless actively announced.
- **HA Entity Registry Category Detection**: Utilizes Home Assistant's `entity_category: "config"` and `entity_category: "diagnostic"` classifications to reliably distinguish primary operational devices from auxiliary settings controls.
- **Expanded Settings Toggle**: Updated dashboard settings to "Show all individual / child entities & internal sensors", allowing users to inspect and optionally announce auxiliary child switches or raw diagnostic sensors with an amber `⚙️ Child / Config` badge.
- **Accurate Domain & Filter Tab Counts**: Switches and All tabs now reflect only physical primary devices when child suppression is active, eliminating dashboard clutter.

## 1.5.6

- **Matter Pump Device (`0x0303`) for Fountains & Water Pumps**: Automatically detects fountain and pump entities (`switch.bedroom_fountain`, `switch.living_room_fountain`, switches with `device_class: pump`, or entities matching fountain/pump/насос/фонтан) and exposes them to Matter as dedicated `PumpDevice` nodes with `PumpConfigurationAndControlServer` (ConstantSpeed feature) and `OnOffServer`. In Google Home, they appear as dedicated water pumps with active power toggles instead of generic switches or plugs.
- **Dual-Layer AC Fan Speed in Google Home**: Added `FanControlServer` (MultiSpeed + Auto) directly to Endpoint 1 (`ThermostatDevice`) in addition to Endpoint 2 (`FanDevice`). Ensures fan speed percentage, steps, and Auto/Low/Medium/High modes appear natively across Google Home ecosystem surfaces regardless of whether Google Home expects fan control on the primary thermostat cluster or as a composed endpoint.
- **Robust Physical Device Grouping**: Integrated Home Assistant Device Registry (`config/device_registry/list`) with elevated Supervisor permissions (`hassio_role: "manager"`, `hassio_api: true`) and cross-domain heuristic fallback (`sensor` & `binary_sensor`). Multi-sensor devices (such as Aqara FP300 presence sensors) roll all child entities (occupancy, temperature, humidity, illuminance, battery) into a single physical device card ("Bathroom presence sensor") by default.
- **Fountain & Pump Dashboard Badges**: Added visual `🌊 Fountain / Pump` pill badges and styling in the web UI dashboard with power toggle support.

## 1.5.5

- **Physical Multi-Sensor Grouping (Instance `_2`, `_3` Suffix Support)**: Fixed sensor base ID matching to support instance numbering (e.g. `sensor.presence_multi_sensor_fp300_temperature_2`, `_humidity_2`, `_battery_2`). Sub-sensors now properly group into their composite physical device ("Bathroom presence sensor") rather than splitting into separate orphan sensor cards.
- **Clean Device Friendly Name Extraction**: Strips trailing sensor role keywords and instance numbers from friendly names (e.g. "Kitchen presence sensor Temperature" -> "Kitchen presence sensor").
- **Hide Internal Sub-Sensors by Default**: Automatically hides internal temperature/humidity/battery sensors that belong to existing switches, lights, or climate units, preventing dashboard clutter.
- **Dashboard Settings Modal ("Show All Sensors")**: Added a Settings modal with a toggle to optionally display all raw, unbundled individual sensors and internal sub-sensors. Persists in backend and dashboard preferences.
- **Home Assistant Device Registry Integration**: Fetches Home Assistant entity and device registries to automatically detect physical hardware device names and groupings.

## 1.5.4

- **Composed Fan Device (`0x002B`) for AC / Climate Nodes**: Exposed a dedicated `FanDevice` child endpoint (endpoint 2) alongside `ThermostatDevice` (endpoint 1) on climate nodes in full compliance with the Matter composed device specification. Solves the issue where Google Home ignored the `FanControl` cluster on the thermostat endpoint; Google Home now natively maps and displays AC fan speed controls (percentages, steps, Auto/Low/Medium/High modes).
- **Resilient Fan Capability Detection**: Automatically detects AC fan support via Home Assistant's `supported_features` bitmask (`FAN_MODE = 8`) or current `fan_mode` state, supplying standard fan modes (`auto`, `low`, `medium`, `high`) even when integrations omit an explicit `fan_modes` array.
- **Fixed UI Periodic Jump & Focus Loss**: Added smart state diffing to the dashboard polling mechanism. Periodic background refresh ticks no longer wipe and recreate the DOM grid if data has not changed, eliminating the periodic jump on focus and preserving active button/input focus and selection.

## 1.5.3

- **"Reset to Re-pair" Button for Commissioned Nodes**: Added a `🔄 Reset to Re-pair` button on all commissioned device cards and pairing panels. Solves the issue where removing a device in Google Home leaves the local Matter node bonded to the orphaned fabric. Clicking this button immediately factory-resets the node, erases its persistent fabric storage, and generates a fresh QR code and pairing passcode ready to be scanned in Google Home.
- **Auto-Wipe on Unannounce**: Stopping or unannouncing a device now cleans up its persistent storage directory, ensuring that re-announcing always starts as a clean, uncommissioned node.
- **Universal Clipboard Fallback**: Fixed the Copy button in the Live Logs viewer and pairing cards. Adds a resilient `execCommand` textarea fallback for Home Assistant Ingress iframes and local HTTP LAN sessions where modern `navigator.clipboard` is restricted.

## 1.5.2

- **Distinctive Multi-Node Sidebar Icon (`mdi:hub`)**: Replaced `mdi:matter` with `mdi:hub` in the Home Assistant configuration. This differentiates Matter Multi-Node from the official Matter Server add-on on the sidebar (which also uses `mdi:matter`), displaying a star-topology hub with connected satellite nodes to represent multi-node Matter.

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
