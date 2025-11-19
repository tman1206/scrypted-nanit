# Nanit Camera Plugin for Scrypted

A Scrypted plugin that integrates Nanit baby monitors with your smart home system. This plugin uses a local RTMP server and WebSocket connection to reliably stream video from Nanit cameras.

## Features

### Tested & Working ✅
- 📹 **Live video streaming** from Nanit cameras
- 🔐 **Secure authentication** with 2FA support
- 🔄 **Automatic token refresh**
- 🌐 **WebSocket-based camera control** with Protocol Buffers
- 📡 **Embedded RTMP server** for reliable streaming
- 🏠 **Home Assistant support** via RTSP rebroadcast
- 🍎 **HomeKit support** via RTSP rebroadcast
- 🔄 **Automatic stale connection recovery**

### Implemented but Untested ⚠️
- 📸 **Snapshot capture** (implemented, needs testing)

## How It Works

This plugin makes Nanit camera feeds accessible to Scrypted and other smart home platforms by:

1. **Running a local RTMP server** within Scrypted (port 1935)
2. **Connecting to Nanit's camera API** via WebSocket using Protocol Buffers
3. **Requesting the camera to stream** to the local RTMP server
4. **Providing the local RTMP stream** to Scrypted for viewing
5. **Enabling RTSP rebroadcast** via Scrypted's Rebroadcast plugin for Home Assistant and HomeKit integration

### Stream Flow

```
Nanit Camera
    ↓
WebSocket (Protobuf)
    ↓
Plugin
    ↓
Local RTMP Server
    ↓
Scrypted
    ↓
Rebroadcast Plugin (optional)
    ↓
RTSP Stream
    ↓
Home Assistant / HomeKit
```

## Installation

This plugin is currently in beta and must be installed manually from GitHub.

### Prerequisites

Before installing, ensure you have:
- **Scrypted** installed and running (https://www.scrypted.app/)
- **Node.js and npm** installed on your development machine
- **Git** installed for cloning the repository

### Step-by-Step Installation

#### 1. Clone the Repository

Clone this repository to your local machine:

```bash
git clone https://github.com/tman1206/scrypted-nanit.git
cd scrypted-nanit
```

**Why**: Downloads the plugin source code to your computer so you can build and deploy it.

#### 2. Install Dependencies

Install all required npm packages:

```bash
npm install
```

**Why**: Downloads all the libraries the plugin needs (WebSocket client, RTMP server, Protocol Buffers, etc.).

#### 3. Build the Plugin

Compile the TypeScript code into JavaScript:

```bash
npm run build
```

**Why**: Scrypted runs JavaScript, so we need to compile our TypeScript source code. This creates the `main.nodejs.js` file that Scrypted will load.

#### 4. Log in to Scrypted (First Time Only)

If this is your first time deploying a plugin, authenticate with your Scrypted server:

```bash
npx scrypted login <your-scrypted-ip>:10443
```

Example: `npx scrypted login 192.168.1.20:10443`

**Why**: Scrypted needs to verify you have permission to deploy plugins to the server. You only need to do this once per development machine.

#### 5. Deploy to Scrypted

Deploy the built plugin to your Scrypted server:

```bash
npm run scrypted-deploy <your-scrypted-ip>:10443
```

Or if using HTTPS without a valid certificate:

```bash
SCRYPTED_INSECURE=true npm run scrypted-deploy <your-scrypted-ip>:10443
```

Example: `SCRYPTED_INSECURE=true npm run scrypted-deploy 192.168.1.20:10443`

**Why**: Uploads the compiled plugin to your Scrypted server and installs it. The `SCRYPTED_INSECURE` flag allows deployment over HTTPS with self-signed certificates.

#### 6. Verify Installation

1. Open your Scrypted web interface
2. Go to **Plugins**
3. You should see **"Nanit Camera Plugin"** in the list
4. The plugin will automatically start

### Updating the Plugin

To update to a newer version:

```bash
cd scrypted-nanit
git pull origin main
npm install
npm run build
SCRYPTED_INSECURE=true npm run scrypted-deploy <your-scrypted-ip>:10443
```

**Why**: Gets the latest code, rebuilds it, and redeploys to your Scrypted server.

## Configuration

### Initial Setup

1. In Scrypted, go to the Nanit Camera Plugin settings
2. Enter your Nanit account **Email**
3. Enter your Nanit account **Password**
4. If you have 2FA enabled:
   - Wait for the 2FA code to be sent to your email/phone
   - Enter the code in the **Two Factor Code** field
5. The plugin will automatically discover your cameras

### Advanced Settings

- **RTMP Port**: Port for the local RTMP server (default: 1935)
  - Change this if port 1935 is already in use
  - Remember to restart the plugin after changing

## Usage

### Setting Up for Home Assistant or HomeKit

To use your Nanit cameras with Home Assistant or HomeKit, you need to enable the Rebroadcast plugin which provides RTSP streams:

1. **Install Rebroadcast Plugin**:
   - In Scrypted, go to **Plugins** → **Install Plugins**
   - Search for `@scrypted/prebuffer-mixin`
   - Click **Install**

2. **Enable Rebroadcast for Your Camera**:
   - Go to your Nanit camera device (e.g., "Blake")
   - Click **Extensions**
   - Enable **Rebroadcast Plugin**
   - The plugin will generate an RTSP stream URL

3. **Get the RTSP URL**:
   - In the camera's Rebroadcast settings, you'll see the RTSP URL
   - Format: `rtsp://192.168.1.20:8554/{camera-id}`
   - Copy this URL for use in Home Assistant or HomeKit

### Home Assistant Integration

Once you have the RTSP URL from Scrypted's Rebroadcast plugin, add the camera to Home Assistant:

1. **Add Generic Camera**:
   - In Home Assistant, go to **Settings** → **Devices & Services**
   - Click **Add Device**
   - Search for and select **Generic Camera**

2. **Configure the Camera**:
   - **Stream Source URL**: Enter the RTSP URL from Scrypted (e.g., `rtsp://192.168.1.20:43793/745d5ef07da708e0`)
   - **RTSP Transport Protocol**: Select **TCP** (recommended for reliability)
   - **Authentication**: Select **basic** (no credentials needed)
   - **Verify SSL certificate**: **Uncheck** this option
   - Click **Submit**

3. Your Nanit camera will appear as a camera entity in Home Assistant

**Alternative: YAML Configuration**

You can also add the camera via `configuration.yaml`:

```yaml
camera:
  - platform: generic
    name: Nanit Blake
    stream_source: rtsp://192.168.1.20:43793/{your-camera-id}
    rtsp_transport: tcp
    verify_ssl: false
```

Replace the RTSP URL with the one from your Scrypted Rebroadcast settings.


### HomeKit Integration

For HomeKit:
1. In Scrypted, go to **Plugins** → **HomeKit**
2. Your Nanit camera should automatically appear in the HomeKit plugin
3. Add to your Home app on iOS/macOS
4. The camera will stream via the Rebroadcast RTSP feed

### Direct Viewing in Scrypted

You can also view cameras directly in Scrypted:
- View live streams in the Scrypted web interface
- Capture snapshots
- Use in Scrypted automations and scenes

## ⚠️ Important: Connection Limit Warning

**Nanit limits the number of simultaneous "Mobile App" connections to 2-3 per camera.** Each WebSocket connection from this plugin counts as one mobile app connection.

### Common Issue: Error 403 - Connection Limit

If you see this error:
```
Status code: 403
Streaming request failed (403): Forbidden: Number of Mobile App connections above limit, declining connection
```

**This happens when:**
- Both **Rebroadcast Plugin** and **WebRTC Plugin** are enabled simultaneously (each creates a separate WebSocket connection)
- The Nanit mobile app is open on your phone/tablet
- Another instance of this plugin or home_assistant_nanit is running
- Previous connections haven't timed out yet

**Solutions:**
1. **For Home Assistant/HomeKit users**: Keep Rebroadcast enabled, but close the Nanit mobile app
2. **For direct Scrypted viewing**: Use WebRTC only, disable Rebroadcast
3. **Wait 5 minutes** for old connections to timeout
4. **Restart the plugin** to clear stale connections
5. **Close the mobile app** on all devices when using Scrypted

**Recommended Setups:**

**For Home Assistant/HomeKit:**
- ✅ Enable **Rebroadcast Plugin** (provides RTSP stream)
- ✅ Enable **WebRTC Plugin** (optional, for Scrypted web viewing)
- ❌ Close **Nanit mobile app** when viewing in HA/HomeKit

**For Direct Scrypted Viewing Only:**
- ✅ Enable **WebRTC Plugin only**
- ❌ Disable **Rebroadcast Plugin**
- ❌ Close **Nanit mobile app**

## Other Notes

The camera is configured as a Battery device in Scrypted. This prevents Scrypted from maintaining a 24/7 connection to the stream, instead connecting only on-demand when viewing is requested. This is intentional to avoid Nanit detecting constant streaming activity.

If you want to enable 24/7 streaming (not recommended), you can remove the Battery interface from the device interfaces in [`src/main.ts`](src/main.ts:503-509).

## Credits

### Methodology
This implementation is based on the architecture from [home_assistant_nanit](https://github.com/indiefan/home_assistant_nanit) by indiefan, adapted for Scrypted with TypeScript and Protocol Buffers.

### Previous Versions
- Original scrypted-nanit plugin (v0.0.10 and earlier) by zone99dev
- Repository: https://github.com/zone99dev/scrypted-nanit

## License

See LICENSE file for details.

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check the `IMPLEMENTATION_NOTES.md` for technical details
- Review Scrypted logs for debugging information

## Changelog

### v0.1.0
- Complete rewrite using WebSocket + local RTMP server approach
- Added Protocol Buffers support for camera communication
- Embedded RTMP server with node-media-server
- WebSocket camera control with automatic reconnection
- Improved authentication with 2FA and token refresh
- Clean logging with appropriate log levels
- Production-ready and tested

### v0.0.10 and earlier
- Original implementation (non-functional direct RTMP approach)
