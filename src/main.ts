import { Battery, Camera, Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings"
import axios, { AxiosRequestConfig } from 'axios'
import WebSocket from 'ws';
import NodeMediaServer from 'node-media-server';
import { client } from './websocket.pb';

const { log, deviceManager, mediaManager } = sdk;

interface NanitBaby {
    uid: string;
    name: string;
    camera_uid?: string;
}

class NanitCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, MotionSensor, Battery {
    private streamUrl: string;

    constructor(public plugin: NanitCameraPlugin, nativeId: string) {
        super(nativeId);
        this.streamUrl = `rtmp://127.0.0.1:${plugin.rtmpPort}/live/${nativeId}`;
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        log.i("Taking a photo from stream for " + this.nativeId);
        
        try {
            // Ensure streaming is active before taking picture
            log.d("[DEBUG] takePicture: Ensuring stream is active...");
            await this.plugin.tryLogin();
            await this.plugin.ensureStreamingActive(this.nativeId);
            log.d("[DEBUG] takePicture: Stream should be active, capturing frame");
            
            const ffmpegInput: FFmpegInput = {
                url: undefined,
                inputArguments: [
                    '-i', this.streamUrl,
                    '-vframes', '1',
                    '-q:v', '2'
                ]
            };
            return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
        } catch (error) {
            log.e("takePicture failed: " + error.message);
            throw error;
        }
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        log.i("Requesting video stream for " + this.nativeId);
        
        try {
            // Ensure we're logged in
            log.d("[DEBUG] Calling tryLogin...");
            await this.plugin.tryLogin();
            log.d("[DEBUG] tryLogin completed");
            
            // Ensure streaming is active for this camera
            log.d("[DEBUG] Calling ensureStreamingActive for " + this.nativeId);
            await this.plugin.ensureStreamingActive(this.nativeId);
            log.d("[DEBUG] ensureStreamingActive completed");
            
            this.batteryLevel = 100;
            
            const ffmpegInput: FFmpegInput = {
                url: undefined,
                inputArguments: [
                    '-i', this.streamUrl,
                ]
            };

            log.d("[DEBUG] Returning stream URL: " + this.streamUrl);
            return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
        } catch (error) {
            log.e("getVideoStream failed: " + error.message);
            log.d("[DEBUG] Stack: " + error.stack);
            throw error;
        }
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [{
            id: this.nativeId + "-stream",
            allowBatteryPrebuffer: false,
            video: {
                codec: 'h264',
            }
        }];
    }

    async startIntercom(media: MediaObject): Promise<void> {
        throw new Error('Intercom not implemented');
    }

    async stopIntercom(): Promise<void> {
    }

    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }
}

class NanitCameraPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings, DeviceCreator {
    devices = new Map<string, NanitCameraDevice>();
    access_token = '';
    refresh_token = '';
    mfa_token = '';
    failedCount = 0;
    babies: NanitBaby[] = [];
    
    // RTMP Server
    private nms: any;
    public rtmpPort = 1935;
    
    // WebSocket connections per camera
    private wsConnections = new Map<string, WebSocket>();
    private wsReconnectTimers = new Map<string, NodeJS.Timeout>();
    private streamingActive = new Map<string, boolean>();
    private lastStreamActivity = new Map<string, number>();
    private streamHealthCheckInterval: NodeJS.Timeout;

    settingsStorage = new StorageSettings(this, {
        email: {
            title: 'Email',
            onPut: async () => this.clearAndTrySyncDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearAndTrySyncDevices(),
        },
        twoFactorCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your account, enter the code sent to your email or phone number.',
            type: "string",
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                await this.syncDevices(0);
            },
            noStore: true,
        },
        refresh_token: {
            title: 'refresh_token'
        },
        access_token: {
            title: 'access_token'
        },
        expiration: {
            title: 'expiration',
            onPut: async () => this.syncDevices(0),
        },
        rtmpPort: {
            title: 'RTMP Port',
            description: 'Port for the local RTMP server (default: 1935)',
            type: 'number',
            defaultValue: 1935,
            onPut: async (oldValue, newValue) => {
                this.rtmpPort = parseInt(newValue as string) || 1935;
                await this.restartRTMPServer();
            }
        },
    });

    constructor() {
        super();
        this.rtmpPort = parseInt(this.settingsStorage.getItem("rtmpPort")) || 1935;
        log.i("Initializing Nanit Camera Plugin v0.1.0 (Beta)");
        this.startRTMPServer();
        this.syncDevices(0);
        this.startStreamHealthCheck();
    }

    private startRTMPServer() {
        try {
            log.i(`Starting RTMP server on port ${this.rtmpPort}`);
            
            const config = {
                rtmp: {
                    port: this.rtmpPort,
                    chunk_size: 60000,
                    gop_cache: true,
                    ping: 30,
                    ping_timeout: 60
                },
                http: {
                    port: this.rtmpPort + 8000,
                    allow_origin: '*'
                }
            };

            this.nms = new NodeMediaServer(config);
            
            this.nms.on('prePublish', (id: string, StreamPath: string, args: any) => {
                log.i('Camera stream connected: ' + StreamPath);
                const match = StreamPath.match(/\/live\/([^\/]+)/);
                if (match) {
                    const babyUid = match[1];
                    this.lastStreamActivity.set(babyUid, Date.now());
                }
            });

            this.nms.on('donePublish', (id: string, StreamPath: string, args: any) => {
                log.i('Camera stream ended: ' + StreamPath);
                const match = StreamPath.match(/\/live\/([^\/]+)/);
                if (match) {
                    const babyUid = match[1];
                    this.streamingActive.set(babyUid, false);
                    this.lastStreamActivity.delete(babyUid);
                }
            });

            this.nms.run();
            log.i('RTMP server started successfully');
        } catch (error) {
            log.e('Failed to start RTMP server: ' + error.message);
        }
    }

    private startStreamHealthCheck() {
        // Check stream health every 60 seconds
        this.streamHealthCheckInterval = setInterval(() => {
            const now = Date.now();
            for (const [babyUid, lastActivity] of this.lastStreamActivity) {
                // If marked as streaming but no activity for 2 minutes, reset
                if (this.streamingActive.get(babyUid) && (now - lastActivity) > 120000) {
                    log.i(`No stream activity for ${babyUid} in 2 minutes, resetting state`);
                    this.streamingActive.set(babyUid, false);
                    this.lastStreamActivity.delete(babyUid);
                    
                    // Close and reconnect WebSocket
                    const ws = this.wsConnections.get(babyUid);
                    if (ws) {
                        ws.close();
                    }
                }
            }
        }, 60000);
    }

    private async restartRTMPServer() {
        log.i('Restarting RTMP server...');
        if (this.nms) {
            try {
                this.nms.stop();
            } catch (error) {
                log.e('Error stopping RTMP server: ' + error.message);
            }
        }
        
        // Close all websocket connections
        for (const [babyUid, ws] of this.wsConnections) {
            ws.close();
        }
        this.wsConnections.clear();
        this.streamingActive.clear();
        
        this.startRTMPServer();
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
            },
            {
                key: 'baby_uid',
                title: 'baby_uid',
            }
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = settings.baby_uid?.toString();

        await deviceManager.onDeviceDiscovered({
            nativeId,
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Camera,
            ],
            name: settings.name?.toString(),
        });
        return nativeId;
    }

    clearAndTrySyncDevices() {
        log.d("clearAndTrySyncDevices called");
        this.access_token = '';
        this.settingsStorage.putSetting("access_token", '');
        this.syncDevices(0);
    }

    async clearAndLogin() {
        log.d("clearAndLogin called");
        this.access_token = '';
        this.settingsStorage.putSetting("access_token", '');
        return this.tryLogin('');
    }

    async tryLogin(twoFactorCode?: string) {
        log.d("Attempting login...");

        const email: string = this.settingsStorage.getItem("email");
        const password: string = this.settingsStorage.getItem("password");
        let saved_access_token = this.settingsStorage.getItem("access_token");
        const expiration = this.settingsStorage.getItem("expiration");
        const refresh_token = this.settingsStorage.getItem("refresh_token");

        if (saved_access_token) {
            this.access_token = saved_access_token;
        }

        if (!email || !password) {
            log.e("Email and password required");
            throw new Error("Email and password required");
        }

        // Check if current token is still valid
        if (this.access_token && expiration > Date.now()) {
            log.d("Access token exists and is not expired, verifying...");
            
            const authenticatedConfig: AxiosRequestConfig = {
                headers: {
                    "nanit-api-version": "1",
                    "Authorization": this.access_token
                },
                validateStatus: function (status) {
                    return (status >= 200 && status < 300) || status == 401;
                }
            };

            try {
                const response = await axios.get("https://api.nanit.com/babies", authenticatedConfig);
                
                if (response.status == 401 && this.failedCount < 2) {
                    log.d('Token invalid (401), clearing and retrying');
                    this.failedCount++;
                    return this.clearAndLogin();
                } else if (this.failedCount >= 2) {
                    throw new Error("Exceeded fail count");
                } else {
                    this.failedCount = 0;
                    log.d("Token verified successfully");
                    return;
                }
            } catch (error) {
                if (error.response?.status == 401 && this.failedCount < 2) {
                    log.d('Token invalid (401), clearing and retrying');
                    this.failedCount++;
                    return this.clearAndLogin();
                }
                throw new Error("Failed to authenticate");
            }
        }

        // Try refresh token if available
        if (refresh_token) {
            log.d("Using refresh token to get new access token");
            const config = {
                headers: {
                    "nanit-api-version": "1"
                }
            };

            try {
                const response = await axios.post("https://api.nanit.com/tokens/refresh", 
                    { "refresh_token": refresh_token }, 
                    config
                );
                
                log.i("Access token refreshed successfully");
                this.failedCount = 0;
                this.access_token = response.data.access_token;
                this.settingsStorage.putSetting("access_token", response.data.access_token);
                this.settingsStorage.putSetting("refresh_token", response.data.refresh_token);
                this.settingsStorage.putSetting("expiration", Date.now() + (1000 * 60 * 60 * 4));
                return;
            } catch (error) {
                log.d("Failed to refresh token, will try full login: " + error.message);
            }
        }

        // Initial login without MFA
        if (!twoFactorCode || !this.mfa_token) {
            log.d("Performing initial login (will need MFA code)");
            const config = {
                headers: {
                    "nanit-api-version": "1"
                }
            };

            try {
                const response = await axios.post("https://api.nanit.com/login",
                    { "email": email, "password": password },
                    config
                );
                
                log.i("Initial login successful, please enter MFA code");
                this.mfa_token = response.data.mfa_token;
                return;
            } catch (error) {
                if (error.response?.data?.mfa_token) {
                    this.mfa_token = error.response.data.mfa_token;
                    log.d("MFA token received from error response");
                    return;
                }
                log.e("Failed initial login: " + error.message);
                throw error;
            }
        }

        // Login with MFA code
        log.d("Performing login with MFA code");
        const config = {
            headers: {
                "nanit-api-version": "1"
            }
        };

        try {
            const response = await axios.post("https://api.nanit.com/login",
                {
                    "email": email,
                    "password": password,
                    "mfa_token": this.mfa_token,
                    "mfa_code": twoFactorCode
                },
                config
            );
            
            this.failedCount = 0;
            log.i("Login with MFA successful");
            this.access_token = response.data.access_token;
            this.settingsStorage.putSetting("access_token", response.data.access_token);
            this.settingsStorage.putSetting("refresh_token", response.data.refresh_token);
            this.settingsStorage.putSetting("expiration", Date.now() + (1000 * 60 * 60 * 4));
        } catch (error) {
            log.e("Failed to login with MFA: " + error.message);
            throw error;
        }
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async syncDevices(duration: number) {
        log.i("Syncing devices...");
        await this.tryLogin();
        
        const config = {
            headers: {
                "nanit-api-version": "1",
                "Authorization": this.access_token
            }
        };

        try {
            const response = await axios.get("https://api.nanit.com/babies", config);
            this.babies = response.data.babies;
            log.d(`[DEBUG] Fetched ${this.babies.length} babies from API`);
            
            const devices: Device[] = [];
            for (const baby of this.babies) {
                log.d(`[DEBUG] Baby: ${baby.name}, UID: ${baby.uid}, Camera UID: ${baby.camera_uid || 'MISSING'}`);
                const nativeId = baby.uid;
                const interfaces = [
                    ScryptedInterface.Camera,
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.Battery
                ];

                const device: Device = {
                    info: {
                        model: 'Nanit Cam',
                        manufacturer: 'Nanit',
                    },
                    nativeId,
                    name: baby.name,
                    type: ScryptedDeviceType.Camera,
                    interfaces,
                };
                devices.push(device);
            }

            await deviceManager.onDevicesChanged({
                devices,
            });
            log.i('Devices discovered: ' + devices.length);
        } catch (error) {
            log.e('Failed to sync devices: ' + error.message);
        }
    }

    async getDevice(nativeId: string) {
        log.d("Getting device: " + nativeId);
        if (!this.devices.has(nativeId)) {
            const camera = new NanitCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        log.d("Releasing device: " + nativeId);
        
        // Close websocket connection for this camera
        const ws = this.wsConnections.get(nativeId);
        if (ws) {
            ws.close();
            this.wsConnections.delete(nativeId);
        }
        
        // Clear reconnect timer
        const timer = this.wsReconnectTimers.get(nativeId);
        if (timer) {
            clearTimeout(timer);
            this.wsReconnectTimers.delete(nativeId);
        }
        
        this.devices.delete(nativeId);
    }

    async ensureStreamingActive(babyUid: string): Promise<void> {
        log.d(`[DEBUG] ensureStreamingActive called for ${babyUid}`);
        log.d(`[DEBUG] Current babies count: ${this.babies.length}`);
        
        // If babies array is empty, sync devices first
        if (this.babies.length === 0) {
            log.d(`[DEBUG] Babies array empty, syncing devices first...`);
            await this.syncDevices(0);
        }
        
        log.d(`[DEBUG] Babies after sync: ${JSON.stringify(this.babies.map(b => ({ uid: b.uid, name: b.name, camera_uid: b.camera_uid })))}`);
        
        // Check if streaming is already active and WebSocket is connected
        const isActive = this.streamingActive.get(babyUid);
        const hasConnection = this.wsConnections.has(babyUid);
        
        if (isActive && hasConnection) {
            log.d(`Streaming already active for ${babyUid}`);
            return;
        }
        
        // If marked active but no connection, reset state
        if (isActive && !hasConnection) {
            log.i(`Streaming marked active but no WebSocket connection, resetting for ${babyUid}`);
            this.streamingActive.set(babyUid, false);
        }

        // Find the baby's camera UID
        const baby = this.babies.find(b => b.uid === babyUid);
        if (!baby) {
            log.e(`Baby not found with UID: ${babyUid}`);
            throw new Error(`Baby not found with UID: ${babyUid}`);
        }
        
        if (!baby.camera_uid) {
            log.e(`Camera UID not found for baby ${babyUid}`);
            log.d(`Baby data: ${JSON.stringify(baby)}`);
            throw new Error(`Camera UID not found for baby ${babyUid}`);
        }

        log.d(`[DEBUG] Found baby ${baby.name} with camera_uid: ${baby.camera_uid}`);
        
        // Connect websocket and request streaming
        await this.connectWebSocket(babyUid, baby.camera_uid);
    }

    private async connectWebSocket(babyUid: string, cameraUid: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Close existing connection if any
            const existingWs = this.wsConnections.get(babyUid);
            if (existingWs) {
                existingWs.close();
            }

            const wsUrl = `wss://api.nanit.com/focus/cameras/${cameraUid}/user_connect`;
            const ws = new WebSocket(wsUrl, {
                headers: {
                    'Authorization': `Bearer ${this.access_token}`
                }
            });

            let resolved = false;

            ws.on('open', () => {
                log.i(`WebSocket connected for ${babyUid}`);
                this.wsConnections.set(babyUid, ws);

                // Send keepalive every 20 seconds using protobuf
                const keepaliveInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            const keepaliveMsg = client.Message.create({
                                type: client.Message.Type.KEEPALIVE
                            });
                            const buffer = client.Message.encode(keepaliveMsg).finish();
                            ws.send(buffer);
                        } catch (error) {
                            log.e('Failed to send keepalive: ' + error.message);
                        }
                    } else {
                        clearInterval(keepaliveInterval);
                    }
                }, 20000);

                // Request streaming to local RTMP server using protobuf
                const streamUrl = `rtmp://192.168.1.20:${this.rtmpPort}/live/${babyUid}`;
                log.d(`[DEBUG] Requesting stream to: ${streamUrl}`);
                log.d(`[DEBUG] Camera UID: ${cameraUid}, Baby UID: ${babyUid}`);
                
                try {
                    // Create protobuf message
                    const message = client.Message.create({
                        type: client.Message.Type.REQUEST,
                        request: {
                            id: Date.now(), // Unique request ID
                            type: client.RequestType.PUT_STREAMING,
                            streaming: {
                                id: client.StreamIdentifier.MOBILE,
                                status: client.Streaming.Status.STARTED,
                                rtmpUrl: streamUrl,
                                attempts: 1
                            }
                        }
                    });

                    // Encode to binary and send
                    const buffer = client.Message.encode(message).finish();
                    log.d(`[DEBUG] Sending protobuf streaming request, buffer size: ${buffer.length}`);
                    ws.send(buffer);
                } catch (error) {
                    log.e('Failed to create/send protobuf message: ' + error.message);
                    log.d('Stack: ' + error.stack);
                }
                
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            });

            ws.on('message', (data: Buffer) => {
                try {
                    log.d(`[WS] Raw protobuf message received for ${babyUid}, length: ${data.length}`);
                    
                    // Decode protobuf binary message
                    const message = client.Message.decode(new Uint8Array(data));
                    log.d(`[WS] Decoded message type: ${client.Message.Type[message.type]}`);
                    
                    if (message.type === client.Message.Type.RESPONSE && message.response) {
                        log.d(`[WS] Response for request ID: ${message.response.requestId}`);
                        log.d(`[WS] Response type: ${client.RequestType[message.response.requestType]}`);
                        log.d(`[WS] Status code: ${message.response.statusCode}`);
                        
                        if (message.response.requestType === client.RequestType.PUT_STREAMING) {
                            if (message.response.statusCode === 200) {
                                log.i(`Streaming started successfully for ${babyUid}`);
                                this.streamingActive.set(babyUid, true);
                            } else {
                                log.e(`Streaming request failed (${message.response.statusCode}): ${message.response.statusMessage}`);
                                this.streamingActive.set(babyUid, false);
                            }
                        }
                    } else if (message.type === client.Message.Type.REQUEST && message.request) {
                        log.d(`[WS] Received request from camera: ${client.RequestType[message.request.type]}`);
                    }
                } catch (error) {
                    log.e('Failed to decode protobuf message: ' + error.message);
                    log.d('[DEBUG] Raw data (hex): ' + data.toString('hex').substring(0, 200));
                }
            });

            ws.on('error', (error) => {
                log.e(`WebSocket error for ${babyUid}: ` + error.message);
                log.d(`WebSocket URL: ${wsUrl}`);
                log.d(`Access token length: ${this.access_token?.length || 0}`);
                if (!resolved) {
                    resolved = true;
                    reject(error);
                }
            });

            ws.on('close', () => {
                log.d(`WebSocket closed for ${babyUid}`);
                this.wsConnections.delete(babyUid);
                this.streamingActive.set(babyUid, false);

                // Attempt to reconnect after 30 seconds
                const timer = setTimeout(() => {
                    log.i(`Reconnecting WebSocket for ${babyUid}...`);
                    this.connectWebSocket(babyUid, cameraUid).catch(err => {
                        log.e(`Failed to reconnect WebSocket for ${babyUid}: ` + err.message);
                    });
                }, 30000);

                this.wsReconnectTimers.set(babyUid, timer);
            });

            // Timeout after 30 seconds if not resolved
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 30000);
        });
    }
}

export default NanitCameraPlugin;
