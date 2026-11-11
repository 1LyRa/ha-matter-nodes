# Changelog

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
