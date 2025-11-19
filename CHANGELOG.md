# Changelog

All notable changes to the Nanit Scrypted Plugin will be documented in this file.

## [0.1.0] - 2025-11-17

### 🎉 Beta Release - Complete Rewrite

This is a complete rewrite of the plugin using the proven architecture from the `home_assistant_nanit` project.

### Added
- **Embedded RTMP Server**: Local RTMP server using `node-media-server` on port 1935
- **WebSocket Communication**: Direct WebSocket connection to Nanit camera API
- **Protocol Buffers Support**: Binary protobuf encoding/decoding for camera communication
- **Automatic Reconnection**: WebSocket auto-reconnects after 30 seconds on disconnect
- **Token Refresh**: Automatic access token refresh using refresh tokens
- **2FA Support**: Multi-factor authentication support
- **Device Discovery**: Automatic discovery of all cameras on account
- **Clean Logging**: Proper log levels (info/debug/error) for production use

### Changed
- **Streaming Approach**: Changed from direct RTMP connection to WebSocket-requested streaming
- **Authentication**: Improved token management with automatic refresh
- **Error Handling**: Better error messages and recovery
- **Module System**: Updated to Node16 for TypeScript compatibility

### Fixed
- **Video Streaming**: Now works reliably (was completely broken in v0.0.10)
- **Race Conditions**: Fixed babies array initialization timing
- **Connection Management**: Proper WebSocket lifecycle management

### Technical Details

**Why the Rewrite?**
The original plugin tried to connect directly to `rtmps://media-secured.nanit.com/nanit/{baby_uid}.{access_token}`, which doesn't work. Nanit cameras don't support direct RTMP connections from clients.

**New Architecture**:
1. Plugin runs local RTMP server
2. Plugin connects to camera via WebSocket
3. Plugin sends protobuf message requesting camera to stream to local RTMP server
4. Camera pushes stream to local RTMP server
5. Scrypted reads from local RTMP server

**Key Discovery**: Nanit uses Protocol Buffers (binary format) for WebSocket communication, not JSON. This was the critical missing piece that prevented the original implementation from working.

### Dependencies
- `ws@^8.14.2` - WebSocket client
- `node-media-server@^2.6.3` - RTMP server
- `protobufjs@^7.2.5` - Protocol Buffer support
- `axios@^1.4.0` - HTTP client
- `@types/ws@^8.5.8` - TypeScript definitions

### Known Limitations
- **Connection Limit**: Nanit limits mobile app connections to 2-3 per camera. Running both Rebroadcast and WebRTC plugins simultaneously may trigger 403 errors. Recommended: Use WebRTC only.
- **Intercom**: Two-way audio not yet implemented
- **Motion Detection**: Not yet implemented via WebSocket messages
- **Network**: Camera must be able to reach the RTMP server (local network or port forwarding required)

### Note on Version Number

This is v0.1.0 (not v1.0.0) because while the plugin is working and tested, it's still in beta. Future versions will add:
- Motion detection via WebSocket
- Two-way audio (intercom)
- Additional stability improvements
- Extended testing across different network configurations

### Migration from v0.0.10

If upgrading from v0.0.10:
1. Uninstall old plugin
2. Install new v1.0.0 plugin
3. Re-enter credentials
4. Cameras will be automatically discovered
5. Disable Rebroadcast Plugin if experiencing 403 errors

---

## [0.0.10] and earlier

### Issues
- Direct RTMP connection approach did not work
- Video streaming was non-functional
- No WebSocket support
- No protobuf support

These versions are deprecated and should not be used.