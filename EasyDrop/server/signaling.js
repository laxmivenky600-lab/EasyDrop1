const sessions = require('./sessions');
const cleanup = require('./cleanup');

function initialize(io) {
    cleanup.startCleanupTask(io);

    io.on('connection', (socket) => {
        socket.on('create-session', (data, callback) => {
            let files = [];
            if (data && data.files) {
                if (!Array.isArray(data.files) || data.files.length > 100) {
                    return callback({ error: 'Too many files. Limit is 100.' });
                }
                for (const f of data.files) {
                    if (typeof f.size !== 'number' || typeof f.name !== 'string') {
                        return callback({ error: 'Invalid file metadata' });
                    }
                    if (f.size > 50 * 1024 * 1024 * 1024) { // 50 GB limit
                        return callback({ error: 'File size exceeds 50GB limit' });
                    }
                }
                files = data.files;
            }

            const session = sessions.createSession(files);
            const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
            let baseUrl = publicUrl;
            if (!baseUrl) {
                const os = require('os');
                const interfaces = os.networkInterfaces();
                let localIp = '127.0.0.1';
                for (const name of Object.keys(interfaces)) {
                    for (const iface of interfaces[name]) {
                        if (iface.family === 'IPv4' && !iface.internal) {
                            localIp = iface.address;
                            break;
                        }
                    }
                    if (localIp !== '127.0.0.1') break;
                }
                const port = process.env.PORT || 3000;
                baseUrl = `http://${localIp}:${port}`;
            }

            callback({
                sessionId: session.sessionId,
                senderToken: session.senderToken,
                receiverToken: session.receiverToken,
                baseUrl
            });
        });

        socket.on('join-session', ({ sessionId, role, token, files }, callback) => {
            const session = sessions.getSession(sessionId);
            if (!session) {
                return callback({ error: 'Session not found or expired' });
            }

            // We allow missing tokens for manual session code entry (simplified for UX)
            if (role === 'sender') {
                if (token && session.senderToken !== token) return callback({ error: 'Invalid token' });
                session.senderSocketId = socket.id;
                if (files) session.files = files; // sender brings files
            } else if (role === 'receiver') {
                if (token && session.receiverToken !== token) return callback({ error: 'Invalid token' });
                session.receiverSocketId = socket.id;
            }

            socket.join(sessionId);
            
            // Notify other peer if present
            socket.to(sessionId).emit('peer-joined', { role, files: session.files });
            
            callback({
                success: true,
                files: session.files,
                peerPresent: role === 'sender' ? !!session.receiverSocketId : !!session.senderSocketId
            });
        });

        function validateSession(sessionId) {
            const session = sessions.getSession(sessionId);
            if (!session) return null;
            if (session.senderSocketId !== socket.id && session.receiverSocketId !== socket.id) return null;
            return session;
        }

        // WebRTC Signaling
        socket.on('offer', ({ sessionId, sdp }) => {
            const session = validateSession(sessionId);
            // WebRTC should only proceed if the session was explicitly accepted
            if (!session || session.state !== 'accepted') return;
            socket.to(sessionId).emit('offer', { sdp });
        });

        socket.on('answer', ({ sessionId, sdp }) => {
            const session = validateSession(sessionId);
            if (!session || session.state !== 'accepted') return;
            socket.to(sessionId).emit('answer', { sdp });
        });

        socket.on('ice-candidate', ({ sessionId, candidate }) => {
            const session = validateSession(sessionId);
            if (!session || session.state !== 'accepted') return;
            socket.to(sessionId).emit('ice-candidate', { candidate });
        });

        // App Signaling
        socket.on('accept', ({ sessionId }) => {
            const session = validateSession(sessionId);
            // Only receiver can accept
            if (session && session.receiverSocketId === socket.id && session.state === 'pending') {
                session.state = 'accepted';
                socket.to(sessionId).emit('accept');
            }
        });

        socket.on('decline', ({ sessionId }) => {
            const session = validateSession(sessionId);
            if (session && session.receiverSocketId === socket.id) {
                socket.to(sessionId).emit('decline');
                sessions.removeSession(sessionId);
            }
        });

        socket.on('cancel', ({ sessionId }) => {
            const session = validateSession(sessionId);
            if (session && session.senderSocketId === socket.id) {
                socket.to(sessionId).emit('cancel');
                sessions.removeSession(sessionId);
            }
        });

        socket.on('complete', ({ sessionId }) => {
            const session = validateSession(sessionId);
            if (session) {
                socket.to(sessionId).emit('complete');
                sessions.removeSession(sessionId);
            }
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
