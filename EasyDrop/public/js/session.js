// WebRTC and Socket.IO connection manager
class EasyDropSession {
    constructor(role) {
        this.role = role; // Initial role
        this.socket = io();
        this.pc = null;
        this.channel = null;
        this.sessionId = null;
        this.files = []; // Files I am sending
        this.receivedFiles = []; // Files I have received
        
        // Callbacks
        this.onPeerJoined = () => {};
        this.onReady = () => {};
        this.onAccepted = () => {};
        this.onDeclined = () => {};
        this.onProgress = () => {};
        this.onComplete = () => {};
        this.onError = () => {};
        this.onFilesUpdated = () => {};

        this.setupSocket();
    }

    setupSocket() {
        this.socket.on('peer-joined', (data) => {
            if (data.files && data.files.length > 0) {
                this.onFilesUpdated(data.files);
            }
            this.onPeerJoined(data);
        });
        
        this.socket.on('accept', () => this.handleAccept());
        this.socket.on('decline', () => this.onDeclined());
        this.socket.on('cancel', () => this.onError('Session cancelled'));
        this.socket.on('complete', () => this.onComplete());
        this.socket.on('expired', () => this.onError('Session expired'));
        this.socket.on('peer-left', () => this.onError('Peer disconnected'));

        // Since WebRTC is symmetrical, we just need one side to create the offer.
        // Let's say the receiver ALWAYS creates the offer when they click "Accept".
        this.socket.on('offer', async ({ sdp }) => {
            console.log(`[Diagnostic] Received offer from peer`);
            await this.setupWebRTC();
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('answer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
            console.log(`[Diagnostic] Answer sent to peer`);
        });

        this.socket.on('answer', async ({ sdp }) => {
            console.log(`[Diagnostic] Received answer from peer`);
            if (this.pc) {
                await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log(`[Diagnostic] Remote description set for answer`);
            }
        });

        this.socket.on('ice-candidate', async ({ candidate }) => {
            console.log(`[Diagnostic] Received remote ICE candidate`);
            if (this.pc) {
                try {
                    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch(e) {
                    console.error(`[Diagnostic] Error adding ICE candidate`, e);
                }
            }
        });
    }

    createSession(files, callback) {
        this.files = files || [];
        const payload = this.files.map(f => ({ name: f.name, size: f.size, type: f.type }));
        this.socket.emit('create-session', { files: payload }, (res) => {
            this.sessionId = res.sessionId;
            this.socket.emit('join-session', { sessionId: this.sessionId, role: this.role, token: this.role === 'sender' ? res.senderToken : res.receiverToken }, () => {
                callback(res);
            });
        });
    }

    joinSession(sessionId, token, files, callback) {
        this.sessionId = sessionId;
        this.files = files || [];
        const payload = this.files.length > 0 ? this.files.map(f => ({ name: f.name, size: f.size, type: f.type })) : null;
        
        this.socket.emit('join-session', { sessionId, role: this.role, token, files: payload }, (res) => {
            if (res.error) return this.onError(res.error);
            if (res.files && res.files.length > 0) {
                this.onFilesUpdated(res.files);
            }
            callback(res);
        });
    }

    async setupWebRTC() {
        if (this.pc) return; // already set up
        
        console.log(`[Diagnostic] Setting up WebRTC connection...`);
        let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        try {
            const res = await fetch('/api/ice-servers');
            if (res.ok) {
                iceServers = await res.json();
                console.log(`[Diagnostic] Fetched ICE servers from backend. Count: ${iceServers.length}`);
            }
        } catch(e) {
            console.warn(`[Diagnostic] Failed to fetch custom ICE servers. Falling back to default STUN.`, e);
        }

        this.pc = new RTCPeerConnection({ iceServers });
        
        this.pc.oniceconnectionstatechange = () => {
            console.log(`[Diagnostic] ICE Connection State: ${this.pc.iceConnectionState}`);
        };

        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.socket.emit('ice-candidate', { sessionId: this.sessionId, candidate: e.candidate });
            }
        };

        // We want data channels to be fully bi-directional.
        // We'll let the 'receiver' role create the channel for consistency (since they create the offer).
        if (this.role === 'receiver') {
            this.channel = this.pc.createDataChannel('easydrop-files', { ordered: true });
            console.log(`[Diagnostic] Created WebRTC Data Channel`);
            this.setupChannel();
        } else {
            this.pc.ondatachannel = (e) => {
                this.channel = e.channel;
                console.log(`[Diagnostic] Received WebRTC Data Channel`);
                this.setupChannel();
            };
        }
    }

    setupChannel() {
        this.channel.binaryType = 'arraybuffer';
        this.channel.onopen = () => {
            console.log(`[Diagnostic] Data Channel is OPEN`);
            this.onReady();
        };
        
        let incomingParts = [];
        let currentMeta = null;
        let currentSize = 0;
        let expectedFilesCount = 0;

        this.channel.onmessage = (e) => {
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);
                if (msg.type === 'batch-start') {
                    expectedFilesCount = msg.count;
                    this.receivedFiles = []; // reset for this batch
                } else if (msg.type === 'start') {
                    currentMeta = msg.meta;
                    incomingParts = [];
                    currentSize = 0;
                } else if (msg.type === 'end') {
                    const blob = new Blob(incomingParts, { type: currentMeta.type });
                    this.receivedFiles.push({ name: currentMeta.name, blob });
                    incomingParts = [];
                    
                    if (this.receivedFiles.length === expectedFilesCount) {
                        this.socket.emit('complete', { sessionId: this.sessionId });
                        this.onComplete();
                    }
                }
            } else {
                incomingParts.push(e.data);
                currentSize += e.data.byteLength;
                this.onProgress(e.data.byteLength);
            }
        };
    }

    async handleAccept() {
        console.log(`[Diagnostic] Transfer accepted, generating WebRTC offer...`);
        this.onAccepted();
        await this.setupWebRTC();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit('offer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
    }

    acceptTransfer() {
        this.socket.emit('accept', { sessionId: this.sessionId });
    }

    declineTransfer() {
        this.socket.emit('decline', { sessionId: this.sessionId });
    }

    cancelTransfer() {
        this.socket.emit('cancel', { sessionId: this.sessionId });
    }

    disconnect() {
        if (this.socket) {
            this.socket.off();
            this.socket.disconnect();
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }
    }

    async sendFiles(filesToSend) {
        if (!this.channel || this.channel.readyState !== 'open') return;
        
        const files = filesToSend || this.files;
        if (!files || files.length === 0) return;

        const CHUNK_SIZE = 16 * 1024;
        this.channel.send(JSON.stringify({ type: 'batch-start', count: files.length }));
        
        for (const file of files) {
            this.channel.send(JSON.stringify({ type: 'start', meta: { name: file.name, size: file.size, type: file.type } }));
            
            let offset = 0;
            while (offset < file.size) {
                if (this.channel.bufferedAmount > 1024 * 1024) {
                    await new Promise(r => setTimeout(r, 50));
                    continue;
                }
                const chunk = file.slice(offset, offset + CHUNK_SIZE);
                const buffer = await chunk.arrayBuffer();
                this.channel.send(buffer);
                offset += buffer.byteLength;
                this.onProgress(buffer.byteLength);
            }
            
            this.channel.send(JSON.stringify({ type: 'end' }));
        }
    }
}

window.EasyDropSession = EasyDropSession;
