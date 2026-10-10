const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const signaling = require('./server/signaling');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Security Middlewares
app.use(helmet({
    contentSecurityPolicy: false, // Don't break existing inline scripts/styles if any
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Increased limit to prevent blocking local development
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/create-transfer', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/create-transfer.html')));
app.get('/session', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html')));
app.get('/receiver', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/session.html'))); // fallback for old link

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
