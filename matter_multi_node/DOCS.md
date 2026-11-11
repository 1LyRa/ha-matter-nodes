# Matter Multi-Node Add-on

Exposes your Home Assistant switches, lights, climate units (AC / Thermostats), and sensors as **individual standalone Matter nodes** (starting on UDP port 5541) **tailored specifically for Google Home**, completely bypassing Google Home's Matter Bridge / Aggregator limitations.

> **Important**: This add-on is designed and tested exclusively for **Google Home**. It is not intended or recommended for Apple Home, Alexa, or multi-admin setups.

## Why this exists
Google Home frequently fails or drops devices when importing large Matter bridges. By presenting each device as an independent standalone Matter accessory:
* There is no Matter Bridge or Aggregator endpoint.
* Google Home treats each device as an individual physical Matter device.
* Google's backend bridge bugs are completely bypassed.

## Installation in Home Assistant (Hyper-V VM)
1. Install the **Samba share** or **Advanced SSH & Web Terminal** add-on in Home Assistant.
2. Navigate to your `/addons` folder.
3. Create a folder named `matter_multi_node` and copy the files from this directory into it.
4. In Home Assistant, go to **Settings** > **Add-ons** > **Add-on Store**.
5. Click the **three dots (top right)** > **Check for updates**.
6. Under the **Local add-ons** section at the top, select **Matter Multi-Node**.
7. Click **Install**, then click **Start**.
8. Turn on **Show in sidebar**.

## Pairing with Google Home
1. Click **Matter Nodes** in your Home Assistant sidebar to open the dashboard.
2. In the **Google Home** app on your phone:
   * Tap **Devices** > **+ (Add)** > **Matter-enabled device**.
   * Point your camera at the device's QR code displayed in the dashboard.
   * Or choose *"Set up without code"* and enter the 11-digit manual pairing code.
3. Google Home will commission the device directly to your local Matter fabric!
