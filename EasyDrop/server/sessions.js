const crypto = require('crypto');

const SESSION_TTL = 5 * 60 * 1000; // 5 minutes
const sessions = new Map();

function createSession(files = [], mode = 'send') {
    const sessionId = `ED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const senderToken = crypto.randomBytes(16).toString('hex');
    const receiverToken = crypto.randomBytes(16).toString('hex');
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_TTL;
    
    const session = {
        sessionId,
        sessionCode: sessionId,
        code: sessionId,
        mode,
        senderToken,
        receiverToken,
        files: Array.isArray(files) ? files : [],
        createdAt,
        expiresAt,
        senderSocketId: null,
        receiverSocketId: null,
        state: 'pending',
        transferStarted: false
    };
    
    sessions.set(sessionId, session);
    return session;
}

function getSession(sessionId) {
    if (!sessionId) return null;
    return sessions.get(sessionId.toUpperCase()) || sessions.get(sessionId);
}

function removeSession(sessionId) {
    if (!sessionId) return false;
    const key = sessions.has(sessionId) ? sessionId : (sessions.has(sessionId.toUpperCase()) ? sessionId.toUpperCase() : null);
    if (key) {
        return sessions.delete(key);
    }
    return false;
}

function getAllSessions() {
    return sessions;
}

module.exports = {
    SESSION_TTL,
    createSession,
    getSession,
    removeSession,
    getAllSessions
};
