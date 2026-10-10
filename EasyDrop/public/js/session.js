// WebRTC and Socket.IO connection manager
class EasyDropSession {
    constructor() {
        this.socket = io();
        this.pc = null;
        this.channel = null;
        this.sessionId = null;
        this.role = null;
        
        // Transfer state
        this.pendingFiles = []; // files selected to be sent
        this.receivedFiles = []; // files received from peer
        
        // Event hooks for UI
        this.onConnectedToPeer = () => {};
        this.onPeerDisconnected = () => {};
        this.onTransferOffer = (filesMeta) => {};
        this.onTransferProgress = (sent, total) => {};
        this.onTransferComplete = () => {};
        this.onTransferDeclined = () => {};
        this.onError = (err) => {};
        
        this._setupSocket();
    }

    _setupSocket() {
        this.socket.on('peer-joined', async () => {
            console.log(`[Diagnostic] Peer joined the session.`);
            // If I am the creator (sender), and someone joined, I should create the WebRTC offer.
            if (this.role === 'creator') {
                await this._initiateWebRTC();
            }
        });

        this.socket.on('offer', async ({ sdp }) => {
            console.log(`[Diagnostic] Received offer from peer`);
            await this._setupWebRTC();
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('answer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
        });

        this.socket.on('answer', async ({ sdp }) => {
            console.log(`[Diagnostic] Received answer from peer`);
            if (this.pc) {
                await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
        
        this.socket.on('peer-left', () => {
            this.onPeerDisconnected();
            this.disconnect();
        });
        
        this.socket.on('expired', () => this.onError('Session expired.'));
    }

    async createSession(callback) {
        this.role = 'creator';
        // Note: we don't send files during session creation anymore. Files are negotiated over WebRTC.
        this.socket.emit('create-session', { files: [] }, (res) => {
            if (res.error) {
                this.onError(res.error);
                return;
            }
            this.sessionId = res.sessionId;
            this.socket.emit('join-session', { sessionId: this.sessionId, role: 'sender', token: res.senderToken }, (joinRes) => {
                if (joinRes.error) return this.onError(joinRes.error);
                callback(res);
            });
        });
    }

    async joinSession(sessionId, callback) {
        this.role = 'joiner';
        this.sessionId = sessionId;
        this.socket.emit('join-session', { sessionId, role: 'receiver', token: null }, (res) => {
            if (res.error) {
                callback({ error: res.error });
                return;
            }
            callback({ success: true });
        });
    }

    async _setupWebRTC() {
        if (this.pc) return;
        console.log(`[Diagnostic] Setting up WebRTC connection...`);
        let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        try {
            const res = await fetch('/api/ice-servers');
            if (res.ok) iceServers = await res.json();
        } catch(e) {
            console.warn(`[Diagnostic] Failed to fetch custom ICE servers.`, e);
        }

        this.pc = new RTCPeerConnection({ iceServers });
        
        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.socket.emit('ice-candidate', { sessionId: this.sessionId, candidate: e.candidate });
            }
        };

        if (this.role === 'creator') {
            this.channel = this.pc.createDataChannel('easydrop-data', { ordered: true });
            this._setupChannel();
        } else {
            this.pc.ondatachannel = (e) => {
                this.channel = e.channel;
                this._setupChannel();
            };
        }
    }
    
    async _initiateWebRTC() {
        await this._setupWebRTC();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit('offer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
    }

    _setupChannel() {
        this.channel.binaryType = 'arraybuffer';
        this.channel.onopen = () => {
            console.log(`[Diagnostic] Data Channel is OPEN`);
            this.onConnectedToPeer();
        };
        
        let incomingParts = [];
        let currentMeta = null;
        let expectedFilesCount = 0;
        let receivedBytes = 0;
        let totalIncomingBytes = 0;

        this.channel.onmessage = (e) => {
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);
                if (msg.type === 'offer-transfer') {
                    totalIncomingBytes = msg.files.reduce((acc, f) => acc + f.size, 0);
                    expectedFilesCount = msg.files.length;
                    this.receivedFiles = []; // reset for the new batch
                    receivedBytes = 0;
                    this.onTransferOffer(msg.files);
                } else if (msg.type === 'accept-transfer') {
                    this._startSendingFiles();
                } else if (msg.type === 'decline-transfer') {
                    this.onTransferDeclined();
                } else if (msg.type === 'start-file') {
                    currentMeta = msg.meta;
                    incomingParts = [];
                } else if (msg.type === 'end-file') {
                    const blob = new Blob(incomingParts, { type: currentMeta.type });
                    this.receivedFiles.push({ name: currentMeta.name, blob });
                    incomingParts = [];
                    
                    if (this.receivedFiles.length === expectedFilesCount) {
                        this.onTransferComplete();
                    }
                }
            } else {
                incomingParts.push(e.data);
                receivedBytes += e.data.byteLength;
                this.onTransferProgress(receivedBytes, totalIncomingBytes);
            }
        };
    }

    offerFiles(files) {
        if (!this.channel || this.channel.readyState !== 'open') return false;
        this.pendingFiles = Array.from(files);
        if (this.pendingFiles.length === 0) return false;
        
        const metadata = this.pendingFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));
        this.channel.send(JSON.stringify({ type: 'offer-transfer', files: metadata }));
        return true;
    }
    
    acceptTransfer() {
        if (this.channel && this.channel.readyState === 'open') {
            this.channel.send(JSON.stringify({ type: 'accept-transfer' }));
        }
    }
    
    declineTransfer() {
        if (this.channel && this.channel.readyState === 'open') {
            this.channel.send(JSON.stringify({ type: 'decline-transfer' }));
        }
    }

    async _startSendingFiles() {
        if (!this.channel || this.channel.readyState !== 'open') return;
        
        const CHUNK_SIZE = 16 * 1024;
        let sentBytes = 0;
        const totalBytes = this.pendingFiles.reduce((acc, f) => acc + f.size, 0);
        
        for (const file of this.pendingFiles) {
            this.channel.send(JSON.stringify({ type: 'start-file', meta: { name: file.name, size: file.size, type: file.type } }));
            
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
                sentBytes += buffer.byteLength;
                this.onTransferProgress(sentBytes, totalBytes);
            }
            
            this.channel.send(JSON.stringify({ type: 'end-file' }));
        }
        
        this.onTransferComplete();
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
}

window.EasyDropSession = EasyDropSession;
