# Changelog

## 1.7.6

- **Security Rating Improvement (Score 5 -> 6)**:
  - Removed unused elevated Supervisor permissions (`hassio_api: true` and `hassio_role: "manager"`).
  - The add-on only requires Home Assistant Core WebSocket access (`homeassistant_api: true`), eliminating unnecessary Supervisor container permissions and raising the official Home Assistant security rating to **6 / 8** (the maximum rating for host-networked Matter/mDNS applications).

## 1.7.5

- **Matter AirQuality Cluster Conformance Fix**:
  - Enabled `AirQuality.Feature.Fair`, `Moderate`, `VeryPoor`, and `ExtremelyPoor` on `AirPurifierDevice`'s `AirQualityServer`.
  - Conforms to the Matter specification by allowing air quality levels 0 through 6 (`Good`, `Fair`, `Moderate`, `Poor`, `VeryPoor`, `ExtremelyPoor`).
  - Resolves startup boot crashes (`Validating ... Conformance "FAIR": Matter does not allow enum value Fair (ID 2) here`) when purifiers report fair or moderate air quality from Home Assistant.
- **Fault-Isolated Startup Loop**:
  - Wrapped each device's startup in `syncWithHAStates` in an isolated `try/catch` block.
  - An error or schema incompatibility on one device can no longer cascade or abort the initialization of other devices.
- **Self-Healing Storage Recovery**:
  - Added automatic recovery for behavior schema/storage validation errors. If an existing node fails to rehydrate due to stale behavior cache from prior versions, its individual storage cache is safely cleared and retried fresh automatically.
- **Canonical Fountain Helper Enforcement**:
  - Explicitly designated `switch.bedroom_fountain` and `switch.living_room_fountain` as the canonical fountain devices.
  - Suppressed duplicate raw-power auxiliary switches (`switch.*_raw_power`) from appearing as separate or dormant devices in the UI.
  - Mapped auxiliary fountain entities to the canonical helper switches and guarded state updates so secondary plug state changes cannot overwrite the helper switch's live ON/OFF status.

## 1.7.4

- **Reflect Home Assistant Version in Matter Hardware Version**:
  - Captured Home Assistant core version during WebSocket authentication (`msg.ha_version`) and exposed it in `basicInformation.hardwareVersionString` (e.g. `HA 2026.11.1`), visible in Matter controller device info panels.
- **Composite Multi-Sensor Availability Logic**:
  - Multi-sensor devices (e.g. Aqara FP300 presence sensors) now evaluate availability across all primary measurement entities (temperature, humidity, occupancy). A transient drop of a single secondary entity no longer marks the device as unavailable.
- **10-Second Availability Debounce**:
  - Introduced a 10-second debounce timer before taking Matter nodes offline (`node.stop()`). Transient integration reloads or momentary 300ms–1s offline spikes in Home Assistant no longer sever Matter controller connections.
- **Bi-Directional Fountain/Pump Synchronization**:
  - Fixed state change handling to ensure pump and fountain devices remain fully synchronized with live Home Assistant states.

## 1.7.3

- **Reflect Home Assistant Entity Offline/Unavailable State in Matter**:
  - Automatically tracks Home Assistant entity availability (`unavailable`, `unknown`).
  - When a commissioned device (e.g. `switch.boiler_new`) goes offline in Home Assistant, the Matter node gracefully stops its operational network listener (`node.stop()`). Google Home and other Matter controllers immediately detect that the device is unreachable and display it as **"Offline"** / **"Not Responding"**.
  - When the entity recovers and comes back online in Home Assistant (`on`, `off`, numeric state), the Matter node automatically resumes network listening (`node.start()`), restoring live control in Google Home without requiring re-pairing or re-commissioning.
  - If a commissioned node is restored from storage at addon boot while the underlying HA entity is offline, it is immediately taken offline to accurately reflect physical availability to controllers.
- **Web Dashboard Offline Indicators & Guard**:
  - Added visual `⚠️ Offline in HA` pills and red status dots (`HA State: UNAVAILABLE`) across device cards in the dashboard.
  - Disabled manual toggle buttons on offline devices to prevent sending void commands into Home Assistant.
  - Guarded `/api/nodes/:deviceId/toggle` against executing service calls on offline entities.

## 1.7.2

- **Fix `resetNodeForDevice` Method Resolution**: Resolved a runtime crash (`TypeError: this.getNextAvailablePort is not a function`) when resetting uninitialized nodes by correctly routing port and discriminator allocation through `allocatePortAndDiscriminator`.
- **Eliminate WebSocket Request & Timer Leaks**: Pending Home Assistant requests now clear their 10-second rejection timeouts immediately upon receipt of response. On unexpected WebSocket disconnection, all in-flight requests are immediately rejected and timers cleared to prevent event-loop leaks.
- **Node Startup Socket & Storage Lock Cleanup**: Wrapped node startup failures in `ServerNode.close()` cleanup to ensure storage locks and network socket allocations are safely released if `node.start()` encounters an error.
- **Prevent Sensor Suppression from Child Switches**: Fixed an issue where auxiliary switches on sensor devices (such as audible or visual alarms on water leak sensors) marked the device as having a primary switch, incorrectly suppressing environmental and leak sensors from the dashboard.
- **Preserve Fountains and Clean Naming**: Ensured fountains and pumps with `raw_power` in their entity ID (e.g. `switch.bedroom_fountain_new_bedroom_fountain_raw_power`) are recognized as primary pump devices and never treated as auxiliary child entities. Enhanced name deduplication removes redundant words and integration artifacts, yielding clean titles like "Bedroom fountain".
- **Real-Time Air Quality UI Refresh**: Included air purifier telemetry (`pm25`, `pm10`, `percentage`, `airQuality`, `hepaFilter`, `carbonFilter`) in frontend card fingerprinting for instant UI rendering upon Home Assistant state updates.

## 1.7.1

- **Matter PM10 Particulate Measurement**: Added `Pm10ConcentrationMeasurementServer` (`Pm10ConcentrationMeasurement.Feature.NumericMeasurement`) to Matter air purifier nodes for live coarse particulate reporting to Google Home and other Matter controllers.
- **Air Filter Condition & Warning Features**: Enabled `HepaFilterMonitoring.Feature.Condition` and `HepaFilterMonitoring.Feature.Warning` (as well as on `ActivatedCarbonFilterMonitoringServer`). These features conform to the Matter specification, allowing Google Home to query the `condition` percentage attribute and render live filter health and replacement alerts.
- **Universal Filter Life Parsing**: Implemented robust parsing for filter sensor entities across percentages (`0-100%`), remaining hours (`h`), remaining days (`d`), and categorical statuses (`good`, `ok`, `warning`, `replace`).
- **Dashboard PM10 & Filter Badges**: Updated web UI purifier cards to display real-time **PM10** readings and air filter health.

## 1.7.0

- **Native Matter AirPurifier Support**: Discovers and unifies air purifiers (including Dyson Purifier Humidify+Cool Formaldehyde De-NOx, Xiaomi, Coway, Levoit) into full-fledged Matter `AirPurifierDevice` (0x002d) nodes. Features discrete fan speed control (`FanControl` with `MultiSpeed` and `Auto`), power toggling (`OnOff`), real-time PM2.5 concentration (`Pm25ConcentrationMeasurement`), air quality level (`AirQuality`), HEPA filter life (`HepaFilterMonitoring`), activated carbon filter life (`ActivatedCarbonFilterMonitoring`), ambient temperature, and relative humidity.
- **Unified Purifier Entity Grouping**: Automatically groups all companion fan, switch (power, auto mode, oscillation, night mode), and sensor (temperature, humidity, PM2.5, PM10, VOC, NOx, AQI, filter life) entities into a single unified device, preventing companion entities from cluttering the switch and sensor grids.
- **Sensor Auxiliary Switch & Child Lock Grouping**: Enhanced auxiliary entity matching and parent discovery to recognize sensor alarm switches (e.g. `switch.bathroom_bathroom_leak_sensor_audible_alarm_enabled`, `switch.bathroom_bathroom_leak_sensor_visual_alarm_enabled`) and smart plug child locks (e.g. `switch.eve_energy_*_child_lock`), linking them to their parent device and hiding them from the main grid unless "Show all sensors / auxiliary entities" is toggled in settings.
- **Standalone Fan Domain Support**: Added native support for standalone Home Assistant `fan.*` entities as Matter `FanDevice` (0x002b) nodes with percentage speed and auto mode control.
- **Air Purifier Web UI Dashboard**: Added `🍃 Air Purifier` and `💨 Fan` badges to the web dashboard along with real-time fan speed, PM2.5, air quality, temperature, humidity, and filter health cards.

## 1.6.2

- **Fountain Raw Power Deduplication**: Removed blanket child-exemption for fountains, ensuring raw power auxiliary switches (such as `switch.bedroom_fountain_new_bedroom_fountain_raw_power` and `switch.living_room_fountain_new_living_room_fountain_raw_power`) are recognized as secondary child switches and mapped to their primary parent (`switch.bedroom_fountain` / `switch.living_room_fountain`). Only the clean, primary fountain switch is exposed as a Matter device.
- **Entity Friendly Name Priority**: Prioritized user-defined entity friendly names over generic hardware model names from the HA Device Registry (e.g. restoring "Bathroom light" instead of "Home Relay 16A Thread").

## 1.6.1

- **Centered 50% Auto Fan Mode**: Mapped `Auto` fan mode directly to 50% on the Matter fan percentage slider. When Google Home sets the fan slider to ~50% (45%–55%), the backend switches the AC fan mode to `Auto`. When Home Assistant is in `Auto` mode, the Matter FanControl cluster updates `percentSetting` / `percentCurrent` to 50%, centering Google Home's fan slider on Auto while distributing discrete manual speeds evenly below and above 50% (`Mute` $\rightarrow$ `Low` $\rightarrow$ `Mid Low` $\rightarrow$ **`Auto (50%)`** $\rightarrow$ `Mid` $\rightarrow$ `Mid High` $\rightarrow$ `High` $\rightarrow$ `Turbo`).
- **Enhanced Name Cleaning**: Enhanced `cleanDeviceFriendlyName` to strip repeated phrases and trailing `raw power` from device registry names as well as friendly names, ensuring fountain pump devices display as clean names (e.g. "Bedroom fountain").

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
