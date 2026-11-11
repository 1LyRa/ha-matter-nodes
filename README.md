# Matter Multi-Node Home Assistant Add-on Repository

Custom Home Assistant Add-on repository to expose Home Assistant switches as **individual standalone Matter accessories** (starting on UDP port 5541) directly to Google Home, Apple Home, and Alexa—completely bypassing Matter Bridge / Aggregator bugs.

---

## Adding this Repository to Home Assistant

1. In Home Assistant, navigate to **Settings** > **Add-ons** > **Add-on Store**.
2. Click the **three dots (top right corner)** and select **Repositories**.
3. Paste the URL of this repository:
   ```
   https://github.com/1LyRa/ha-matter-nodes
   ```
4. Click **Add**.
5. Close the dialog. The store will refresh, and you will see **Matter Multi-Node** listed in the store.
6. Click **Matter Multi-Node**, then click **Install**.
7. Enable **Start on boot** and **Show in sidebar**, then click **Start**.

---

## Hyper-V VM Network Requirements (Crucial!)
Because Matter requires direct UDP discovery (mDNS / DNS-SD on IPv6 & IPv4):
1. **Virtual Switch**: Ensure your Home Assistant VM in Hyper-V is connected to an **External Virtual Switch** linked directly to your physical network adapter (Ethernet/Wi-Fi).
2. **Do Not Use Default Switch**: The Hyper-V "Default Switch" uses NAT, which blocks inbound UDP and local mDNS discovery.
3. **IPv6**: Ensure IPv6 is enabled on your router and LAN adapter.

---

## How to Pair Devices to Google Home
1. Open **Matter Nodes** from your Home Assistant sidebar.
2. In the **Google Home** app on your phone:
   - Tap **Devices** > **+ (Add)** > **Matter-enabled device**.
   - Point your phone's camera at the QR code displayed for the switch.
   - Or tap *"Set up without code"* and paste the 11-digit manual pairing code.
3. Repeat for each switch you need.

---

## Configuration Options

| Option | Default | Description |
| :--- | :--- | :--- |
| `start_port` | `5541` | Starting UDP port for Matter nodes (each node takes `start_port + index`). |
| `discriminator_start` | `3841` | Starting 12-bit discriminator for discovery. |
| `passcode` | `20202021` | Commissioning passcode for manual pairing. |
| `filter_domains` | `["switch", "input_boolean"]` | HA entity domains to automatically expose. |
| `include_entities` | `[]` | Specific entity IDs to expose (if set, overrides domain filter). |
| `exclude_entities` | `[]` | Specific entity IDs to ignore. |
