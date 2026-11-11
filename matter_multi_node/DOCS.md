# Matter Multi-Node Add-on

Exposes your Home Assistant switches, lights, climate units (AC / Thermostats), and sensors as **individual standalone Matter nodes** (starting on UDP port 5541) **tailored specifically for Google Home**, completely bypassing Google Home's Matter Bridge / Aggregator limitations.

> **Important**: This add-on is designed and tested exclusively for **Google Home**. It is not intended or recommended for Apple Home, Alexa, or multi-admin setups.

## Why this exists
Google Home frequently fails or drops devices when importing large Matter bridges. By presenting each device as an independent standalone Matter accessory:
* There is no Matter Bridge or Aggregator endpoint.
* Google Home treats each device as an individual physical Matter device.
* Google's backend bridge bugs are completely bypassed.
* ACs and Thermostats include a dedicated On/Off power button and fan speed controls right inside Google Home.
* Commissioned devices collapse their pairing codes to keep the dashboard clean.

## Installation

1. In Home Assistant, navigate to **Settings** > **Add-ons** > **Add-on Store**.
2. Click the **three dots** in the top-right corner and select **Repositories**.
3. Add the repository URL:
   ```text
   https://github.com/1LyRa/ha-matter-nodes
   ```
4. Click **Add**, then close the dialog.
5. In the store, find **Matter Multi-Node** and click **Install**.
6. Enable **Start on boot** and **Show in sidebar**, then click **Start**.

> **Network Note**: Ensure your Home Assistant host is bridged directly to your local physical network so Google Nest Hubs and phones on your LAN can discover and communicate with Matter UDP ports.

## Pairing with Google Home
1. Click **Matter Nodes** in your Home Assistant sidebar to open the dashboard.
2. In the **Google Home** app on your phone:
   * Tap **Devices** > **+ (Add)** > **Matter-enabled device**.
   * Point your camera at the device's QR code displayed in the dashboard.
   * Or choose *"Set up without code"* and enter the 11-digit manual pairing code.
3. Google Home will commission the device directly to your local Matter fabric!
