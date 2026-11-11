# Project Handoff: Matter Multi-Node for Home Assistant

**Repository URL**: [https://github.com/1LyRa/ha-matter-nodes](https://github.com/1LyRa/ha-matter-nodes)  
**Git Branch**: `main`  
**Current Version**: `1.4.0`  
**Location in Workspace**: `/home/dizir/ha-matter-nodes` (`\\wsl.localhost\Ubuntu\home\dizir\ha-matter-nodes`)

---

## 1. Problem Context & Purpose

### The Core Problem
When connecting Home Assistant (HA) devices to Google Home via Matterbridge or standard Matter bridges (Aggregators), Google Home frequently fails during commissioning, drops child endpoints, or leaves devices permanently "Offline". ADB logs reveal Google Home's cloud backend fails when parsing complex dynamic descriptor trees and endpoint parts lists.

### The Solution: `ha-matter-nodes`
Instead of running a monolithic Matter bridge, this Home Assistant Add-on exposes selected devices as **independent, standalone Matter accessories** (`ServerNode`):
- **No Bridge / Aggregator Endpoint**: Each device has its own Root Node and standard device type (`OnOffPlugInUnit`, `TemperatureSensor`, etc.).
- **Sequential UDP Ports**: Each device binds a dedicated port starting at `5541` (leaving default `5540` free for other Matter servers).
- **Dormant by Default**: Discovers HA entities, but does not bind ports or broadcast mDNS until explicitly enabled via the UI.
- **Smart Composite Sensor Grouping**: Groups related temperature, humidity, and battery sensors (e.g., `sensor.living_room_living_room_sensor_new_*`) into a single physical Matter device with **one QR code**.
- **Embedded Ingress UI**: Native Home Assistant dashboard (supporting Auto, Light, and Dark themes) displaying high-contrast scannable QR codes and 11-digit manual pairing codes.

---

## 2. Architecture & Tech Stack

```text
                               ┌─── [ServerNode 1: UDP 5541] (Switch)    ──> Google Home
                               ├─── [ServerNode 2: UDP 5542] (Sensor)    ──> Google Home
[HA WebSocket API] <───────────┼─── [ServerNode N: UDP 554N]             ──> Google Home
(ws://supervisor/core/websocket)
                               │
                               └─── [Express Server: Port 8099] <─────── Home Assistant Ingress UI
```

- **Runtime**: Node.js 22 on Alpine Linux (`node:22-alpine`).
- **Core Dependencies**:
  - `@matter/main` (`^0.18.0`): Protocol implementation (crypto, mDNS, session management, TLV, cluster definitions).
  - `ws` (`^8.18.0`): Real-time Home Assistant WebSocket communication.
  - `express` (`^4.21.2`): Ingress web dashboard and REST API.
  - `qrcode` (`^1.5.4`): In-memory data URL generation for commissioning QR codes.
- **Persistence**:
  - Add-on container mounts `/data/matter`.
  - `/data/matter/enabled_entities.json`: Remembers activated devices and their port/discriminator allocations.
  - `/data/matter/<device_id>/`: Stores cryptographic Matter fabric credentials (NOC, DAC, CASE sessions) so Google Home pairings survive container restarts.

---

## 3. Directory & File Map

```text
ha-matter-nodes/
├── repository.yaml               # HA Add-on Repository manifest (defines store metadata)
├── README.md                     # User documentation & custom repo installation guide
├── CHANGELOG.md                  # Release notes parsed by HA Supervisor update modal
├── HANDOFF.md                    # This developer & project handoff guide
├── .gitignore
└── matter_multi_node/            # The actual Add-on directory (matches slug)
    ├── config.yaml               # HA Add-on configuration (Ingress, host_network, options)
    ├── Dockerfile                # Multi-arch Alpine Docker build recipe
    ├── run.sh                    # Container start script (ensures /data/matter exists)
    ├── package.json              # Node.js project manifest (type: module, v1.2.0)
    ├── DOCS.md                   # In-app store documentation
    ├── CHANGELOG.md              # Add-on level changelog
    ├── .dockerignore
    └── src/
        ├── index.js              # Application entry point & process lifecycle
        ├── config.js             # Option parser (/data/options.json + supervisor token)
        ├── ha-client.js          # HA WebSocket client (auth, get_states, subscribe_events)
        ├── matter-manager.js     # Standalone ServerNode manager (ports, mDNS, sensors/switches)
        ├── web-server.js         # Express web server for Ingress & REST API endpoints
        └── public/               # Frontend Dashboard
            ├── index.html        # Semantic HTML layout with theme picker & filter tabs
            ├── style.css         # Home Assistant native design system (Light / Dark / Auto)
            └── app.js            # Live WebSocket polling, clipboard copy, toggle, announce
```

---

## 4. Current State & Testing

### What is Completed (v1.4.0)
1. **Custom Repository Integration**: Published to `https://github.com/1LyRa/ha-matter-nodes` and verified working in Home Assistant Add-on Store.
2. **Exact Device Naming in Google Home & Apple Home**:
   - Injects entity friendly names directly into Matter's `BasicInformation` (`nodeLabel`, `productName`, `productLabel`, `vendorName`), preventing generic names ("Switch", "Matter device") during Google Home commissioning.
   - Automatically propagates friendly name renames in Home Assistant to the live Matter node.
3. **AC & Thermostats (`climate.*`)**:
   - Standalone `ThermostatDevice` accessories paired with `ThermostatServer` and `ThermostatUserInterfaceConfigurationServer`.
   - Dynamic feature negotiation based on HA entity capabilities: `Heating`, `Cooling`, and `AutoMode`.
   - Full bidirectional HVAC mode switching (`off`, `cool`, `heat`, `auto`).
   - Single target setpoint and dual setpoint (heating + cooling deadband) synchronization conforming strictly to Matter's constraint boundaries (heating: 700..3000, cooling: 1600..3200 in $0.01^\circ\text{C}$).
   - Live ambient temperature reporting with seamless Celsius / Fahrenheit unit conversion.
   - Debounced dispatching of `climate.set_temperature` and `climate.set_hvac_mode`.
   - UI Climate tab with ambient temp, target setpoints, HVAC state indicators, and power toggle.
4. **Lights (`light.*`)**:
   - Simple lights mapped to `OnOffLightDevice`.
   - Dimmable lights mapped to `DimmableLightDevice` (with smooth 0–255 to 1–254 brightness sync).
   - Tunable white lights mapped to `ColorTemperatureLightDevice` (Mireds and Kelvin support).
   - Color / RGB lights mapped to `ExtendedColorLightDevice` (CIE 1931 XY coordinates).
   - Real-time debounced updates preventing redundant HA WebSocket calls.
5. **Switches & Booleans**: `switch.*`, `input_boolean.*` mapped to Matter `OnOffPlugInUnitDevice` with bidirectional state synchronization.
6. **Multi-Sensors**:
   - Tested and verified with `sensor.living_room_living_room_sensor_new_temperature`, `..._humidity`, and `..._battery`.
   - Maps to `TemperatureSensorDevice` (EP 1) with `PowerSourceServer.with('Battery')` + `HumiditySensorDevice` (EP 2).
   - Real-time updates push temperature (converted to $0.01^\circ\text{C}$), humidity ($0.01\%$), and battery remaining ($0.5\%$ steps) to Matter controllers.
7. **On-Demand Announcement**: Zero mDNS or port allocation on startup until user clicks "Announce as Matter Device".
8. **UI & Themes**: Light, Dark, and Auto theme switcher following Home Assistant design guidelines, with filter tabs for All, Switches, Lights, Climate, Sensors, Active, and Unannounced.
9. **Supervisor Update Dialog**: Added `CHANGELOG.md` files so version updates show full change notes.

---

## 5. Potential Future Roadmap

When continuing this project in a new session:
1. **Covers / Blinds**: Map `cover.*` to Matter `WindowCoveringDevice` (position and open/close tilt).
2. **Fan Support**: Map `fan.*` to Matter `FanDevice` (speed percentages and on/off).
3. **Lock Support**: Map `lock.*` to Matter `DoorLockDevice`.
4. **GitHub Actions CI / Pre-built Images**: Add a `.github/workflows/build.yaml` to pre-compile Docker images to GitHub Container Registry (`ghcr.io/1LyRa/ha-matter-nodes-{arch}`), reducing add-on installation time in HA from 3 minutes to ~10 seconds.
