# Matter Multi-Node Home Assistant Add-on

Custom Home Assistant Add-on that exposes your switches, lights, climate units (AC/Thermostats), and sensors as **individual standalone Matter accessories tailored specifically for Google Home**—completely bypassing Google Home's Matter Bridge / Aggregator limitations.

> [!IMPORTANT]
> **Tailored Specifically for Google Home**: This add-on is engineered and optimized exclusively to solve Google Home's well-documented Matter bridge and aggregator limitations (endpoint drops, device state corruption, and pairing failures). It is **not designed, tested, or recommended for Apple Home, Home Assistant Matter Server, or Alexa fabrics**—its standalone single-accessory architecture is tuned specifically for reliable Google Home local control.

---

## Why this exists
Google Home frequently fails or corrupts device states when importing large Matter bridges. By presenting each device as an independent standalone Matter accessory:
- **No Matter Bridge**: Each device has its own dedicated Matter node without an Aggregator endpoint.
- **Dedicated Port**: Dynamically allocates sequential UDP ports starting at `5541` (leaving `5540` untouched for existing Matter servers).
- **Exact Device Naming**: Injects Home Assistant entity friendly names into Matter's `BasicInformation` (`nodeLabel`, `productName`, and `vendorName`) so Google Home pre-fills the exact HA name automatically.
- **Dormant by Default**: Discovers devices automatically, but only announces and generates QR codes for devices you explicitly choose.
- **Smart Sensor Grouping**: Groups multi-sensor devices (Temperature + Humidity + Battery) into a single Matter device with one QR code.

---

## Supported Devices

- **Thermostats & Air Conditioners**: `climate.*`
  - Matter `ThermostatDevice` with UI configuration
  - **Dedicated On/Off Power Toggle**: Standalone power button directly inside Google Home cards and detail view via Matter `OnOffServer`.
  - **Fan Speed & Mode Controls**: Full multi-speed fan control, percentage slider, and mode selection (`Auto`, `Low`, `Medium`, `High`) via Matter `FanControlServer`.
  - Dual and single setpoint sync (Cooling / Heating / Auto)
  - Full HVAC mode synchronization (`off`, `cool`, `heat`, `auto`)
  - Ambient room temperature reporting with automatic unit conversion (°C / °F)
- **Lights**: `light.*`
  - Simple Lights (Matter `OnOffLight`)
  - Dimmable Lights (Matter `DimmableLight`, 0–255 to 1–254 level translation)
  - Color Temperature Lights (Matter `ColorTemperatureLight`, Mireds / Kelvin support)
  - Full Color RGB / Spectrum Lights (Matter `ExtendedColorLight`, CIE 1931 XY coordinates)
- **Switches & Booleans**: `switch.*`, `input_boolean.*` (Matter `OnOffPlugInUnit`)
- **Temperature Sensors**: `sensor.*_temperature` (Matter `TemperatureSensor`, supports °C and °F)
- **Humidity Sensors**: `sensor.*_humidity` (Matter `HumiditySensor`)
- **Battery Reporting**: Automatically attached to sensors with matching `_battery` entities.

---

## Installation via Custom Repository

1. In Home Assistant, navigate to **Settings** > **Add-ons** > **Add-on Store**.
2. Click the **three dots (top-right corner)** and select **Repositories**.
3. Add the repository URL:
   ```text
   https://github.com/1LyRa/ha-matter-nodes
   ```
4. Click **Add**, then close the dialog.
5. In the store, find **Matter Multi-Node** and click **Install**.
6. Enable **Start on boot** and **Show in sidebar**, then click **Start**.

> **Network Note**: Ensure your Home Assistant host/VM is bridged directly to your local physical network (not isolated behind NAT) so Google Nest Hubs and phones on your LAN can discover and communicate with Matter UDP ports.

---

## How to Pair Devices to Google Home

1. Open **Matter Nodes** in your Home Assistant sidebar.
2. Select the switch, light, climate unit, or sensor you want to connect and click **"Announce as Matter Device"**.
3. Open the **Google Home** app on your phone:
   - Tap **Devices** > **+ (Add)** > **Matter-enabled device**.
   - Scan the QR code displayed on the dashboard (or enter the 11-digit manual pairing code).
4. Google Home connects directly to your device via local Matter!

---

## Important Notes

### Google Home Device Naming
- **Initial Pairing**: During initial commissioning, Google Home reads `BasicInformation` (`nodeLabel` and `productName`) and automatically pre-fills the Home Assistant friendly name into Google Home's cloud database.
- **Existing Paired Devices**: If a device was already paired prior to updating or renaming, Google Home does not overwrite its cloud-cached device name automatically (to protect custom user names in the app). To update the name, either edit it in Google Home (**Device Settings** > **Name**) or delete and re-pair the accessory.

### Update Progress Bar
Home Assistant builds local add-ons from source (`Dockerfile`) when no pre-compiled container image is declared, which causes the Supervisor UI to display 0% until the build finishes. This repository includes a GitHub Actions workflow (`.github/workflows/publish.yaml`) using the official Home Assistant Builder to push multi-arch images (`amd64`, `aarch64`) to `ghcr.io`. Once published, configuring `image:` in `config.yaml` enables native layer download progress reporting in the Supervisor.
