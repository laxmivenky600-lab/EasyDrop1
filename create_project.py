import os

base_dir = "c:/Users/laxmi/Downloads/Easy-Platform/Easy-Platform/EasyDrop"

files_to_create = {
    f"{base_dir}/package.json": """{
  "name": "easydrop",
  "version": "1.0.0",
  "description": "EasyDrop file transfer",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  }
}
""",
    f"{base_dir}/server.js": """const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const signaling = require('./server/signaling');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/create-transfer', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/create-transfer.html')));
app.get('/session', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html')));
app.get('/receiver', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html'))); // fallback for old link

signaling.initialize(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`EasyDrop server running on port ${PORT}`);
});
""",
    f"{base_dir}/server/sessions.js": """const crypto = require('crypto');

const sessions = new Map();

function createSession(files) {
    const sessionId = `ED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const senderToken = crypto.randomBytes(16).toString('hex');
    const receiverToken = crypto.randomBytes(16).toString('hex');
    
    const session = {
        sessionId,
        senderToken,
        receiverToken,
        files,
        createdAt: Date.now(),
        senderSocketId: null,
        receiverSocketId: null
    };
    
    sessions.set(sessionId, session);
    return session;
}

function getSession(sessionId) {
    return sessions.get(sessionId);
}

function removeSession(sessionId) {
    sessions.delete(sessionId);
}

function getAllSessions() {
    return sessions;
}

module.exports = {
    createSession,
    getSession,
    removeSession,
    getAllSessions
};
""",
    f"{base_dir}/server/signaling.js": """const sessions = require('./sessions');
const cleanup = require('./cleanup');

function initialize(io) {
    cleanup.startCleanupTask(io);

    io.on('connection', (socket) => {
        socket.on('create-session', (data, callback) => {
            const session = sessions.createSession(data.files);
            callback({
                sessionId: session.sessionId,
                senderToken: session.senderToken,
                receiverToken: session.receiverToken
            });
        });

        socket.on('join-session', ({ sessionId, role, token }, callback) => {
            const session = sessions.getSession(sessionId);
            if (!session) {
                return callback({ error: 'Session not found or expired' });
            }

            if (role === 'sender') {
                if (session.senderToken !== token) return callback({ error: 'Invalid token' });
                session.senderSocketId = socket.id;
            } else if (role === 'receiver') {
                if (session.receiverToken !== token) return callback({ error: 'Invalid token' });
                session.receiverSocketId = socket.id;
            }

            socket.join(sessionId);
            
            // Notify other peer if present
            socket.to(sessionId).emit('peer-joined', { role });
            
            callback({
                success: true,
                files: session.files,
                peerPresent: role === 'sender' ? !!session.receiverSocketId : !!session.senderSocketId
            });
        });

        // WebRTC Signaling
        socket.on('offer', ({ sessionId, sdp }) => {
            socket.to(sessionId).emit('offer', { sdp });
        });

        socket.on('answer', ({ sessionId, sdp }) => {
            socket.to(sessionId).emit('answer', { sdp });
        });

        socket.on('ice-candidate', ({ sessionId, candidate }) => {
            socket.to(sessionId).emit('ice-candidate', { candidate });
        });

        // App Signaling
        socket.on('accept', ({ sessionId }) => {
            socket.to(sessionId).emit('accept');
        });

        socket.on('decline', ({ sessionId }) => {
            socket.to(sessionId).emit('decline');
            sessions.removeSession(sessionId);
        });

        socket.on('cancel', ({ sessionId }) => {
            socket.to(sessionId).emit('cancel');
            sessions.removeSession(sessionId);
        });

        socket.on('complete', ({ sessionId }) => {
            socket.to(sessionId).emit('complete');
            sessions.removeSession(sessionId);
        });

        socket.on('disconnect', () => {
            // Find sessions this socket was part of and notify the other party
            for (const [sessionId, session] of sessions.getAllSessions().entries()) {
                if (session.senderSocketId === socket.id) {
                    session.senderSocketId = null;
                    io.to(sessionId).emit('peer-left', { role: 'sender' });
                } else if (session.receiverSocketId === socket.id) {
                    session.receiverSocketId = null;
                    io.to(sessionId).emit('peer-left', { role: 'receiver' });
                }
            }
        });
    });
}

module.exports = { initialize };
""",
    f"{base_dir}/server/cleanup.js": """const sessions = require('./sessions');

const SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function startCleanupTask(io) {
    setInterval(() => {
        const now = Date.now();
        for (const [sessionId, session] of sessions.getAllSessions().entries()) {
            if (now - session.createdAt > SESSION_TTL) {
                io.to(sessionId).emit('expired');
                sessions.removeSession(sessionId);
            }
        }
    }, 10000); // Check every 10 seconds
}

module.exports = { startCleanupTask };
""",
    f"{base_dir}/public/index.html": """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EasyDrop - Scan. Connect. Share.</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <header class="navbar">
        <div class="nav-container">
            <a href="/" class="logo">EasyDrop</a>
            <nav class="nav-links">
                <a href="/">Home</a>
                <a href="#how-it-works">How It Works</a>
                <a href="#features">Features</a>
                <a href="#security">Security</a>
                <a href="/create-transfer" class="btn-primary-small">Create Transfer</a>
            </nav>
        </div>
    </header>

    <main>
        <section class="hero">
            <h1>Scan. Connect. Share.</h1>
            <p>Share files instantly between devices using a simple QR code. No account. No cloud storage. No nearby-device searching.</p>
            <div class="hero-actions">
                <a href="/create-transfer" class="btn-primary">Create Transfer</a>
                <a href="#how-it-works" class="btn-secondary">How It Works</a>
            </div>
            <ul class="hero-features">
                <li>No account required</li>
                <li>No cloud storage</li>
                <li>Direct device-to-device transfer</li>
            </ul>
        </section>

        <section id="how-it-works" class="section">
            <h2>How EasyDrop Works</h2>
            <p class="subtitle">A simple connection. A clear approval. A direct transfer.</p>
            <div class="steps">
                <div class="step">
                    <h3>01 — Create a Transfer</h3>
                    <p>The sender selects the files they want to share.</p>
                </div>
                <div class="step">
                    <h3>02 — Scan or Enter Code</h3>
                    <p>The receiver scans the QR code using their phone camera.</p>
                </div>
                <div class="step">
                    <h3>03 — Connect</h3>
                    <p>The two browsers establish a temporary connection.</p>
                </div>
                <div class="step">
                    <h3>04 — Send or Receive</h3>
                    <p>Both connected devices have equal permissions.</p>
                </div>
                <div class="step">
                    <h3>05 — Complete</h3>
                    <p>Files are transferred directly between browsers.</p>
                </div>
            </div>
        </section>

        <section id="features" class="section bg-light">
            <h2>Everything you need for a simple file handoff.</h2>
            <div class="cards">
                <div class="card">
                    <h3>QR-Based Sharing</h3>
                    <p>Connect devices quickly using a temporary QR code.</p>
                </div>
                <div class="card">
                    <h3>Two-Way Transfer</h3>
                    <p>Both connected devices can send and receive files.</p>
                </div>
                <div class="card">
                    <h3>No Cloud Storage</h3>
                    <p>Files are transferred directly via WebRTC.</p>
                </div>
            </div>
        </section>

        <section id="security" class="section">
            <h2>Your files stay yours.</h2>
            <p class="subtitle">EasyDrop is designed around temporary sessions, receiver consent, and direct browser-to-browser transfer.</p>
            <div class="cards">
                <div class="card">
                    <h3>Receiver Consent</h3>
                    <p>No file bytes transferred until receiver approves.</p>
                </div>
                <div class="card">
                    <h3>Temporary Sessions</h3>
                    <p>QR sessions expire automatically.</p>
                </div>
            </div>
        </section>

        <section class="final-cta">
            <h2>Ready to share?</h2>
            <p>Create a temporary connection and share files directly between your devices.</p>
            <a href="/create-transfer" class="btn-primary">Create Transfer</a>
            <p class="small">No account. No cloud storage. No app required.</p>
        </section>
    </main>

    <footer>
        <div class="footer-content">
            <h3>EasyDrop</h3>
            <p>Scan. Connect. Share.</p>
            <div class="footer-links">
                <a href="/">Home</a>
                <a href="#how-it-works">How It Works</a>
                <a href="/create-transfer">Create Transfer</a>
            </div>
            <p class="small">Temporary QR access. Direct peer-to-peer file transfer. No saved transfer history.</p>
        </div>
    </footer>
    <script src="/js/main.js"></script>
</body>
</html>
""",
    f"{base_dir}/public/pages/create-transfer.html": """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Transfer - EasyDrop</title>
    <link rel="stylesheet" href="/css/style.css">
    <link rel="stylesheet" href="/css/transfer.css">
</head>
<body>
    <header class="navbar">
        <div class="nav-container">
            <a href="/" class="logo">EasyDrop</a>
        </div>
    </header>

    <main class="transfer-container">
        <div id="selection-view" class="view active">
            <h2>Pick what goes. Nothing else.</h2>
            <div class="drop-zone" id="drop-zone">
                <p>Drop files here or click to browse</p>
                <input type="file" id="file-input" multiple style="display: none;">
                <button class="btn-secondary" onclick="document.getElementById('file-input').click()">Browse files</button>
            </div>
            <div id="file-list" class="file-list"></div>
            <button id="create-session-btn" class="btn-primary" disabled>Create Transfer</button>
        </div>

        <div id="qr-view" class="view" style="display: none;">
            <h2>Scan to Connect</h2>
            <div id="qr-container"></div>
            <p id="status-text">Waiting for receiver...</p>
            <div id="transfer-controls" style="display: none;">
                <button id="send-files-btn" class="btn-primary">Send Files</button>
            </div>
            <div id="progress-container" style="display: none;">
                <div class="progress-bar"><div id="progress-fill"></div></div>
                <p id="progress-text">0%</p>
            </div>
            <button id="cancel-btn" class="btn-secondary">Cancel Session</button>
        </div>
    </main>

    <!-- Include libraries -->
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="/js/qr.js"></script>
    <script src="/js/session.js"></script>
    <script src="/js/transfer.js"></script>
</body>
</html>
""",
    f"{base_dir}/public/pages/session.html": """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receive Transfer - EasyDrop</title>
    <link rel="stylesheet" href="/css/style.css">
    <link rel="stylesheet" href="/css/transfer.css">
</head>
<body>
    <header class="navbar">
        <div class="nav-container">
            <a href="/" class="logo">EasyDrop</a>
        </div>
    </header>

    <main class="transfer-container">
        <div id="receiver-view" class="view active">
            <h2>Incoming Transfer</h2>
            <p id="status-text">Connecting to session...</p>
            <div id="file-list" class="file-list"></div>
            
            <div id="approval-controls" style="display: none;">
                <button id="accept-btn" class="btn-primary">Accept Transfer</button>
                <button id="decline-btn" class="btn-secondary">Decline</button>
            </div>

            <div id="progress-container" style="display: none;">
                <div class="progress-bar"><div id="progress-fill"></div></div>
                <p id="progress-text">0%</p>
            </div>
            
            <div id="download-controls" style="display: none;">
                <button id="download-all-btn" class="btn-primary">Download All as ZIP</button>
            </div>
        </div>
    </main>

    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="/js/session.js"></script>
    <script src="/js/transfer.js"></script>
</body>
</html>
""",
    f"{base_dir}/public/css/style.css": """
:root {
    --primary: #315fe4;
    --primary-hover: #274fcb;
    --bg-light: #f5f7fb;
    --text-dark: #1a2943;
    --text-muted: #69768c;
    --border: #e6eaf1;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', sans-serif; background: #fff; color: var(--text-dark); line-height: 1.6; }

.navbar { border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.9); position: sticky; top: 0; z-index: 100; }
.nav-container { max-width: 1160px; margin: 0 auto; padding: 0 20px; height: 68px; display: flex; justify-content: space-between; align-items: center; }
.logo { font-weight: 800; font-size: 18px; color: var(--text-dark); text-decoration: none; }
.nav-links a { margin-left: 20px; color: var(--text-muted); text-decoration: none; font-size: 14px; font-weight: 600; }
.nav-links a:hover { color: var(--primary); }

.btn-primary, .btn-primary-small, .btn-secondary {
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 8px; font-weight: bold; text-decoration: none; cursor: pointer; border: none;
}
.btn-primary { background: var(--primary); color: white; padding: 12px 24px; font-size: 14px; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary-small { background: var(--primary); color: white; padding: 8px 16px; font-size: 12px; }
.btn-secondary { background: white; border: 1px solid var(--border); color: var(--text-dark); padding: 12px 24px; font-size: 14px; }
.btn-secondary:hover { background: var(--bg-light); }

.section, .hero, .final-cta { padding: 80px 20px; max-width: 1160px; margin: 0 auto; }
.hero h1 { font-size: 60px; line-height: 1.1; margin-bottom: 20px; }
.hero p { font-size: 18px; color: var(--text-muted); max-width: 600px; margin-bottom: 30px; }
.hero-actions { display: flex; gap: 15px; margin-bottom: 30px; }
.hero-features { display: flex; gap: 20px; list-style: none; font-size: 12px; color: var(--text-muted); font-weight: 600; }

.bg-light { background: var(--bg-light); max-width: 100%; }
h2 { font-size: 32px; margin-bottom: 10px; }
.subtitle { color: var(--text-muted); margin-bottom: 40px; }

.steps { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.step, .card { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
.cards { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }

footer { background: var(--bg-light); padding: 40px 20px; text-align: center; border-top: 1px solid var(--border); }
.footer-links a { margin: 0 10px; color: var(--text-muted); text-decoration: none; }
.small { font-size: 12px; color: var(--text-muted); margin-top: 20px; }
""",
    f"{base_dir}/public/css/transfer.css": """
.transfer-container { max-width: 800px; margin: 60px auto; padding: 20px; }
.view { background: white; border: 1px solid var(--border); border-radius: 20px; padding: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
.drop-zone { border: 2px dashed #cdd7e7; border-radius: 16px; padding: 40px; text-align: center; background: #fafbfd; margin: 20px 0; }
.drop-zone.dragover { border-color: var(--primary); background: #f0f4ff; }
.file-list { margin: 20px 0; max-height: 300px; overflow-y: auto; }
.file-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 10px; }
#qr-container { text-align: center; margin: 30px 0; }
#qr-container img { margin: 0 auto; border-radius: 12px; border: 1px solid var(--border); padding: 10px; }
.progress-bar { width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 20px 0; }
#progress-fill { height: 100%; background: var(--primary); width: 0%; transition: width 0.3s; }
""",
    f"{base_dir}/public/js/main.js": """
// Homepage interactions like smooth scrolling
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});
""",
    f"{base_dir}/public/js/qr.js": """
function generateQR(data, elementId) {
    const qr = qrcode(0, 'M');
    qr.addData(data);
    qr.make();
    document.getElementById(elementId).innerHTML = qr.createImgTag(5, 10);
}
""",
    f"{base_dir}/public/js/session.js": """
// WebRTC and Socket.IO connection manager
class EasyDropSession {
    constructor(role) {
        this.role = role;
        this.socket = io();
        this.pc = null;
        this.channel = null;
        this.sessionId = null;
        this.files = [];
        this.receivedFiles = [];
        
        // Callbacks
        this.onPeerJoined = () => {};
        this.onReady = () => {};
        this.onAccepted = () => {};
        this.onDeclined = () => {};
        this.onProgress = () => {};
        this.onComplete = () => {};
        this.onError = () => {};

        this.setupSocket();
    }

    setupSocket() {
        this.socket.on('peer-joined', () => this.onPeerJoined());
        this.socket.on('accept', () => this.handleAccept());
        this.socket.on('decline', () => this.onDeclined());
        this.socket.on('cancel', () => this.onError('Session cancelled by sender'));
        this.socket.on('complete', () => this.onComplete());
        this.socket.on('expired', () => this.onError('Session expired'));
        this.socket.on('peer-left', () => this.onError('Peer disconnected'));

        this.socket.on('offer', async ({ sdp }) => {
            if (this.role !== 'receiver') return;
            this.setupWebRTC();
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('answer', { sessionId: this.sessionId, sdp: this.pc.localDescription });
        });

        this.socket.on('answer', async ({ sdp }) => {
            if (this.role !== 'sender') return;
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        });

        this.socket.on('ice-candidate', async ({ candidate }) => {
            if (this.pc) {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        });
    }

    createSession(files, callback) {
        this.files = files;
        this.socket.emit('create-session', { files: files.map(f => ({ name: f.name, size: f.size, type: f.type })) }, (res) => {
            this.sessionId = res.sessionId;
            this.socket.emit('join-session', { sessionId: this.sessionId, role: 'sender', token: res.senderToken }, () => {
                callback(res);
            });
        });
    }

    joinSession(sessionId, token, callback) {
        this.sessionId = sessionId;
        this.socket.emit('join-session', { sessionId, role: 'receiver', token }, (res) => {
            if (res.error) return this.onError(res.error);
            this.files = res.files;
            callback(res);
        });
    }

    setupWebRTC() {
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        
        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.socket.emit('ice-candidate', { sessionId: this.sessionId, candidate: e.candidate });
            }
        };

        if (this.role === 'sender') {
            this.channel = this.pc.createDataChannel('easydrop-files', { ordered: true });
            this.setupChannel();
        } else {
            this.pc.ondatachannel = (e) => {
                this.channel = e.channel;
                this.setupChannel();
            };
        }
    }

    setupChannel() {
        this.channel.binaryType = 'arraybuffer';
        this.channel.onopen = () => this.onReady();
        
        if (this.role === 'receiver') {
            let incomingParts = [];
            let currentMeta = null;
            let currentSize = 0;

            this.channel.onmessage = (e) => {
                if (typeof e.data === 'string') {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'start') {
                        currentMeta = msg.meta;
                        incomingParts = [];
                        currentSize = 0;
                    } else if (msg.type === 'end') {
                        const blob = new Blob(incomingParts, { type: currentMeta.type });
                        this.receivedFiles.push({ name: currentMeta.name, blob });
                        incomingParts = [];
                        
                        if (this.receivedFiles.length === this.files.length) {
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
    }

    async handleAccept() {
        this.onAccepted();
        this.setupWebRTC();
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

    async sendFiles() {
        if (!this.channel || this.channel.readyState !== 'open') return;
        
        const CHUNK_SIZE = 16 * 1024;
        
        for (const file of this.files) {
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
""",
    f"{base_dir}/public/js/transfer.js": """
const isReceiver = window.location.pathname.includes('receiver');

if (!isReceiver) {
    // SENDER LOGIC
    let selectedFiles = [];
    let session = new window.EasyDropSession('sender');
    let totalSize = 0;
    let sentBytes = 0;

    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const fileList = document.getElementById('file-list');
    const createBtn = document.getElementById('create-session-btn');
    
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

    function handleFiles(files) {
        selectedFiles = Array.from(files);
        totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        fileList.innerHTML = selectedFiles.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
        createBtn.disabled = selectedFiles.length === 0;
    }

    createBtn.addEventListener('click', () => {
        document.getElementById('selection-view').style.display = 'none';
        document.getElementById('qr-view').style.display = 'block';
        
        session.createSession(selectedFiles, (res) => {
            const receiverUrl = `${window.location.origin}/receiver?sessionId=${res.sessionId}&token=${res.receiverToken}`;
            generateQR(receiverUrl, 'qr-container');
        });
    });

    session.onPeerJoined = () => { document.getElementById('status-text').innerText = 'Receiver connected. Waiting for approval...'; };
    session.onAccepted = () => { document.getElementById('status-text').innerText = 'Connecting peer-to-peer...'; };
    session.onReady = () => {
        document.getElementById('status-text').innerText = 'Ready to send';
        document.getElementById('transfer-controls').style.display = 'block';
    };
    
    document.getElementById('send-files-btn').addEventListener('click', () => {
        document.getElementById('transfer-controls').style.display = 'none';
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('status-text').innerText = 'Sending files...';
        session.sendFiles();
    });

    session.onProgress = (bytes) => {
        sentBytes += bytes;
        const percent = Math.min(100, Math.round((sentBytes / totalSize) * 100));
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').innerText = percent + '%';
    };

    session.onComplete = () => {
        document.getElementById('status-text').innerText = 'Transfer Complete!';
        document.getElementById('cancel-btn').style.display = 'none';
    };
    
    session.onError = (err) => { alert(err); window.location.reload(); };
    document.getElementById('cancel-btn').addEventListener('click', () => { session.cancelTransfer(); window.location.reload(); });
} else {
    // RECEIVER LOGIC
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    const token = params.get('token');
    
    if (!sessionId || !token) {
        document.getElementById('status-text').innerText = 'Invalid link.';
    } else {
        let session = new window.EasyDropSession('receiver');
        let totalSize = 0;
        let receivedBytes = 0;

        session.joinSession(sessionId, token, (res) => {
            totalSize = res.files.reduce((acc, f) => acc + f.size, 0);
            document.getElementById('status-text').innerText = `Received request for ${res.files.length} files`;
            document.getElementById('file-list').innerHTML = res.files.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
            document.getElementById('approval-controls').style.display = 'block';
        });

        document.getElementById('accept-btn').addEventListener('click', () => {
            document.getElementById('approval-controls').style.display = 'none';
            document.getElementById('status-text').innerText = 'Connecting peer-to-peer...';
            session.acceptTransfer();
        });
        document.getElementById('decline-btn').addEventListener('click', () => { session.declineTransfer(); window.location.href = '/'; });

        session.onReady = () => {
            document.getElementById('status-text').innerText = 'Receiving files...';
            document.getElementById('progress-container').style.display = 'block';
        };

        session.onProgress = (bytes) => {
            receivedBytes += bytes;
            const percent = Math.min(100, Math.round((receivedBytes / totalSize) * 100));
            document.getElementById('progress-fill').style.width = percent + '%';
            document.getElementById('progress-text').innerText = percent + '%';
        };

        session.onComplete = () => {
            document.getElementById('status-text').innerText = 'Transfer Complete!';
            document.getElementById('progress-container').style.display = 'none';
            document.getElementById('download-controls').style.display = 'block';
        };

        document.getElementById('download-all-btn').addEventListener('click', () => {
            const zip = new JSZip();
            session.receivedFiles.forEach(f => zip.file(f.name, f.blob));
            zip.generateAsync({type:"blob"}).then(content => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = "easydrop.zip";
                link.click();
            });
        });
        
        session.onError = (err) => { alert(err); window.location.href = '/'; };
    }
}
"""
}

for path, content in files_to_create.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

print("Created Vanilla JS EasyDrop project successfully.")
