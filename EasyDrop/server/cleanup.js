const sessions = require('./sessions');

function startCleanupTask(io) {
    setInterval(() => {
        const now = Date.now();
        for (const [sessionId, session] of sessions.getAllSessions().entries()) {
            if (now > session.expiresAt) {
                // Do not interrupt a file transfer that has already started just because the QR countdown expires
                const isTransferActive = session.transferStarted || (session.senderSocketId && session.receiverSocketId) || session.state === 'accepted' || session.state === 'transferring';
                if (!isTransferActive) {
                    io.to(sessionId).emit('expired');
                    sessions.removeSession(sessionId);
                }
            }
        }
    }, 10000); // Check every 10 seconds
}

module.exports = { startCleanupTask };

