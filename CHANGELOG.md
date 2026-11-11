# Changelog

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
