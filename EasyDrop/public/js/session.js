// WebRTC and Socket.IO connection manager
class EasyDropSession {
    constructor() {
        this.socket = io({
            reconnectionAttempts: 5,
            timeout: 10000
        });
        this.pc = null;
        this.channel = null;
        this.sessionId = null;
        this.sessionCode = null;
        this.expiresAt = null;
        this.role = null;
        
        // Transfer state
        this.pendingFiles = []; // files selected to be sent
        this.receivedFiles = []; // files received from peer
        
        // Event hooks for UI
        this.onConnectedToPeer = () => {};
        this.onPeerDisconnected = () => {};
        this.onTransferOffer = (filesMeta) => {};
        this.onTransferProgress = (sent, total, fileName, currentFileBytes, currentFileSize) => {};
        this.onTransferComplete = () => {};
        this.onTransferDeclined = () => {};
        this.onError = (err) => {};
        
        this._setupSocket();
    }

    _setupSocket() {
        this.socket.on('connect_error', (err) => {
            console.warn('[Diagnostic] Socket connect error:', err ? err.message : err);
        });

        this.socket.on('peer-joined', async () => {
            console.log('[Diagnostic] Peer joined the session.');
            // The creator initiates the WebRTC offer
            if (this.role === 'creator') {
                await this._initiateWebRTC();
            }
        });

        this.socket.on('offer', async ({ sdp }) => {
            console.log('[Diagnostic] Received offer from peer');
            await this._setupWebRTC();
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('answer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
        });

        this.socket.on('answer', async ({ sdp }) => {
            console.log('[Diagnostic] Received answer from peer');
            if (this.pc) {
                await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            }
        });

        this.socket.on('ice-candidate', async ({ candidate }) => {
            console.log('[Diagnostic] Received remote ICE candidate');
            if (this.pc && candidate) {
                try {
                    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('[Diagnostic] Error adding ICE candidate', e);
                }
            }
        });
        
        this.socket.on('peer-left', () => {
            this.onPeerDisconnected();
            this.disconnect();
        });
        
        this.socket.on('expired', () => {
            this.onError('Session expired.');
        });
    }

    async createSession(creatorRole, callback) {
        this.role = 'creator';

        // 1. First attempt: create session via backend REST API
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: creatorRole, files: [] }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data && data.sessionId) {
                    this.sessionId = data.sessionId;
                    this.sessionCode = data.sessionCode || data.code || data.sessionId;
                    this.expiresAt = data.expiresAt;

                    const token = creatorRole === 'sender' ? data.senderToken : data.receiverToken;
                    const attachSocket = () => {
                        this.socket.emit('join-session', { sessionId: this.sessionId, role: creatorRole, token }, (joinRes) => {
                            if (joinRes && joinRes.error) {
                                console.warn('[Diagnostic] Socket join error after REST creation:', joinRes.error);
                            }
                        });
                    };

                    if (this.socket.connected) {
                        attachSocket();
                    } else {
                        this.socket.once('connect', attachSocket);
                    }

                    if (typeof callback === 'function') {
                        callback(data);
                    }
                    return data;
                }
            }
        } catch (apiErr) {
            console.warn('[Diagnostic] REST session creation failed, falling back to Socket.IO:', apiErr.message);
        }

        // 2. Fallback to Socket.IO create-session with reliable timeout
        return new Promise((resolve, reject) => {
            let handled = false;
            const timer = setTimeout(() => {
                if (!handled) {
                    handled = true;
                    const timeoutError = 'Session creation timed out. Please check your network connection and try again.';
                    this.onError(timeoutError);
                    if (typeof callback === 'function') {
                        callback({ error: timeoutError });
                    }
                    reject(new Error(timeoutError));
                }
            }, 7000);

            const emitCreate = () => {
                this.socket.emit('create-session', { mode: creatorRole, files: [] }, (res) => {
                    if (handled) return;
                    handled = true;
                    clearTimeout(timer);

                    if (!res || res.error) {
                        const errMsg = (res && res.error) || 'Failed to create session on server.';
                        this.onError(errMsg);
                        if (typeof callback === 'function') callback({ error: errMsg });
                        reject(new Error(errMsg));
                        return;
                    }

                    this.sessionId = res.sessionId;
                    this.sessionCode = res.sessionCode || res.code || res.sessionId;
                    this.expiresAt = res.expiresAt;
                    const token = creatorRole === 'sender' ? res.senderToken : res.receiverToken;

                    this.socket.emit('join-session', { sessionId: this.sessionId, role: creatorRole, token }, (joinRes) => {
                        if (joinRes && joinRes.error) {
                            this.onError(joinRes.error);
                            if (typeof callback === 'function') callback({ error: joinRes.error });
                            reject(new Error(joinRes.error));
                            return;
                        }
                        if (typeof callback === 'function') callback(res);
                        resolve(res);
                    });
                });
            };

            if (this.socket.connected) {
                emitCreate();
            } else {
                this.socket.once('connect', emitCreate);
            }
        });
    }

    async joinSession(sessionId, role, callback) {
        this.role = 'joiner';
        this.sessionId = sessionId;
        this.sessionCode = sessionId;

        let handled = false;
        const timer = setTimeout(() => {
            if (!handled) {
                handled = true;
                const err = 'Connection timed out while connecting to session.';
                if (typeof callback === 'function') callback({ error: err });
            }
        }, 10000);

        const doJoin = () => {
            this.socket.emit('join-session', { sessionId, role, token: null }, (res) => {
                if (handled) return;
                handled = true;
                clearTimeout(timer);

                if (!res || res.error) {
                    const err = (res && res.error) || 'Failed to connect to session.';
                    if (typeof callback === 'function') callback({ error: err });
                    return;
                }
                if (typeof callback === 'function') callback({ success: true, ...res });
            });
        };

        if (this.socket.connected) {
            doJoin();
        } else {
            this.socket.once('connect', doJoin);
        }
    }

    async _setupWebRTC() {
        if (this.pc) return;
        console.log('[Diagnostic] Setting up WebRTC connection...');
        let iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
        try {
            const res = await fetch('/api/ice-servers');
            if (res.ok) iceServers = await res.json();
        } catch (e) {
            console.warn('[Diagnostic] Failed to fetch custom ICE servers.', e);
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
            console.log('[Diagnostic] Data Channel is OPEN');
            this.onConnectedToPeer();
        };
        
        let incomingParts = [];
        let currentMeta = null;
        let expectedFilesCount = 0;
        let receivedBytes = 0;
        let totalIncomingBytes = 0;
        let currentFileReceivedBytes = 0;

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
                    currentFileReceivedBytes = 0;
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
                currentFileReceivedBytes += e.data.byteLength;
                this.onTransferProgress(receivedBytes, totalIncomingBytes, currentMeta ? currentMeta.name : '', currentFileReceivedBytes, currentMeta ? currentMeta.size : 0);
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
                this.onTransferProgress(sentBytes, totalBytes, file.name, offset, file.size);
            }
            
            this.channel.send(JSON.stringify({ type: 'end-file' }));
        }
        
        this.onTransferComplete();
    }

    cancelSession() {
        if (this.sessionId) {
            if (this.socket && this.socket.connected) {
                this.socket.emit('cancel', { sessionId: this.sessionId });
            }
            fetch(`/api/sessions/${encodeURIComponent(this.sessionId)}/cancel`, { method: 'POST' }).catch(() => {});
        }
        this.disconnect();
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
