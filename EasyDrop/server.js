const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const signaling = require('./server/signaling');

const sessions = require('./server/sessions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Security Middlewares
app.use(helmet({
    contentSecurityPolicy: false, // Don't break existing inline scripts/styles if any
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Increased limit to prevent blocking local development
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/create-transfer', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html')));
app.get('/session', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html')));
app.get('/receiver', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html'))); // fallback for old link

// Session REST API Endpoints
app.post(['/api/sessions', '/api/session/create'], (req, res) => {
    try {
        let files = [];
        const mode = (req.body && req.body.mode) ? req.body.mode : 'send';
        if (req.body && req.body.files) {
            if (!Array.isArray(req.body.files) || req.body.files.length > 100) {
                return res.status(400).json({ error: 'Too many files. Limit is 100.' });
            }
            for (const f of req.body.files) {
                if (typeof f.size !== 'number' || typeof f.name !== 'string') {
                    return res.status(400).json({ error: 'Invalid file metadata' });
                }
                if (f.size > 50 * 1024 * 1024 * 1024) {
                    return res.status(400).json({ error: 'File size exceeds 50GB limit' });
                }
            }
            files = req.body.files;
        }

        const session = sessions.createSession(files, mode);
        const baseUrl = signaling.getBaseUrl(req);

        return res.status(201).json({
            success: true,
            sessionId: session.sessionId,
            sessionCode: session.sessionId,
            code: session.sessionId,
            mode: session.mode,
            senderToken: session.senderToken,
            receiverToken: session.receiverToken,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            expiresIn: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
            baseUrl
        });
    } catch (err) {
        console.error('Error creating session via REST API:', err);
        return res.status(500).json({ error: 'Internal server error creating session' });
    }
});

app.get(['/api/sessions/:sessionId', '/api/session/:sessionId'], (req, res) => {
    const session = sessions.getSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
    }
    const baseUrl = signaling.getBaseUrl(req);
    return res.json({
        success: true,
        sessionId: session.sessionId,
        sessionCode: session.sessionId,
        code: session.sessionId,
        mode: session.mode,
        state: session.state,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        expiresIn: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
        baseUrl
    });
});

app.post(['/api/sessions/:sessionId/cancel', '/api/session/:sessionId/cancel'], (req, res) => {
    const session = sessions.getSession(req.params.sessionId);
    if (session) {
        io.to(session.sessionId).emit('cancel');
        sessions.removeSession(session.sessionId);
    }
    return res.json({ success: true });
});

app.get('/api/ice-servers', (req, res) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
        iceServers.push({
            urls: process.env.TURN_URL,
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_PASSWORD
        });
    }
    res.json(iceServers);
});

signaling.initialize(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`EasyDrop server running on port ${PORT}`);
});
