const assert = require('assert');
const { io } = require('socket.io-client');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
    console.log('🧪 Starting EasyDrop Comprehensive Verification...\n');

    // ─── Test 1: Static Files & HTML Routes ───────────────────────────
    console.log('▶ Test 1: Checking Routes & Static Assets...');
    const routes = ['/', '/create-transfer', '/session', '/receiver', '/js/qrcode.min.js', '/js/qr.js', '/js/session.js', '/js/transfer.js', '/api/ice-servers'];
    for (const r of routes) {
        const res = await fetch(`${BASE_URL}${r}`);
        assert.strictEqual(res.status, 200, `Route ${r} returned status ${res.status}`);
        console.log(`  ✓ Route ${r}: HTTP ${res.status}`);
    }

    // ─── Test 2: REST API Session Creation (Send Mode) ────────────────
    console.log('\n▶ Test 2: REST API Session Creation (Send Mode)...');
    const createSendRes = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'send',
            files: [{ name: 'test-document.pdf', size: 1024 * 1024 }]
        })
    });
    assert.strictEqual(createSendRes.status, 201, `Expected 201, got ${createSendRes.status}`);
    const sendSession = await createSendRes.json();
    assert.ok(sendSession.sessionId.startsWith('ED-'), 'sessionId must start with ED-');
    assert.strictEqual(sendSession.sessionCode, sendSession.sessionId, 'sessionCode must match sessionId');
    assert.strictEqual(sendSession.code, sendSession.sessionId, 'code must match sessionId');
    assert.ok(sendSession.senderToken, 'senderToken must exist');
    assert.ok(sendSession.receiverToken, 'receiverToken must exist');
    assert.ok(sendSession.expiresAt > Date.now(), 'expiresAt must be in future');
    assert.ok(sendSession.expiresIn >= 295 && sendSession.expiresIn <= 300, 'expiresIn must be ~300');
    console.log('  ✓ Session created successfully:', sendSession.sessionId);
    console.log('  ✓ Real Code returned:', sendSession.sessionCode);
    console.log('  ✓ Expiry time (seconds):', sendSession.expiresIn);
    console.log('  ✓ Base URL:', sendSession.baseUrl);

    // ─── Test 3: REST API Session Creation (Receive Mode) ─────────────
    console.log('\n▶ Test 3: REST API Session Creation (Receive Mode)...');
    const createRecvRes = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'receive', files: [] })
    });
    assert.strictEqual(createRecvRes.status, 201);
    const recvSession = await createRecvRes.json();
    assert.strictEqual(recvSession.mode, 'receive');
    console.log('  ✓ Receive mode session created:', recvSession.sessionId);

    // ─── Test 4: Query Session via GET /api/sessions/:id ──────────────
    console.log('\n▶ Test 4: Query Session via GET /api/sessions/:id...');
    const getRes = await fetch(`${BASE_URL}/api/sessions/${sendSession.sessionId}`);
    assert.strictEqual(getRes.status, 200);
    const queriedSession = await getRes.json();
    assert.strictEqual(queriedSession.sessionId, sendSession.sessionId);
    console.log('  ✓ Successfully queried session details');

    // ─── Test 5: Cancel Session via POST /api/sessions/:id/cancel ─────
    console.log('\n▶ Test 5: Cancel Session via API...');
    const cancelRes = await fetch(`${BASE_URL}/api/sessions/${sendSession.sessionId}/cancel`, { method: 'POST' });
    assert.strictEqual(cancelRes.status, 200);
    const getAfterCancel = await fetch(`${BASE_URL}/api/sessions/${sendSession.sessionId}`);
    assert.strictEqual(getAfterCancel.status, 404, 'Session should no longer exist after cancel');
    console.log('  ✓ Session cancellation and removal verified');

    // ─── Test 6: Socket.IO create-session and join-session ───────────
    console.log('\n▶ Test 6: Socket.IO create-session & Two-device Pairing...');
    await new Promise((resolve, reject) => {
        const sender = io(BASE_URL);
        const receiver = io(BASE_URL);

        sender.on('connect', () => {
            sender.emit('create-session', { mode: 'send', files: [] }, (res) => {
                try {
                    assert.ok(res.success, 'Socket session creation succeeded');
                    assert.ok(res.sessionId, 'Valid sessionId present');
                    assert.strictEqual(res.sessionCode, res.sessionId);
                    console.log('  ✓ Socket.IO created session:', res.sessionId);

                    sender.emit('join-session', { sessionId: res.sessionId, role: 'sender', token: res.senderToken }, (senderJoinRes) => {
                        assert.ok(senderJoinRes.success);
                        console.log('  ✓ Sender joined session successfully');

                        sender.on('peer-joined', ({ role }) => {
                            console.log(`  ✓ Sender received peer-joined event for role: ${role}`);
                            assert.strictEqual(role, 'receiver');
                            sender.disconnect();
                            receiver.disconnect();
                            resolve();
                        });

                        // Receiver joins now
                        receiver.emit('join-session', { sessionId: res.sessionId, role: 'receiver', token: null }, (receiverJoinRes) => {
                            assert.ok(receiverJoinRes.success);
                            console.log('  ✓ Receiver joined session successfully');
                        });
                    });
                } catch (err) {
                    sender.disconnect();
                    receiver.disconnect();
                    reject(err);
                }
            });
        });

        sender.on('connect_error', reject);
        receiver.on('connect_error', reject);
    });

    // ─── Test 7: QR Code Generator Execution ─────────────────────────
    console.log('\n▶ Test 7: Testing QR Code Generation Logic...');
    const qrcodeGen = require('qrcode-generator');
    const testQrData = `https://easydrop.example.com/session?sessionId=ED-TEST1234&role=receiver`;
    const qr = qrcodeGen(0, 'M');
    qr.addData(testQrData);
    qr.make();
    const svgTag = qr.createSvgTag(6, 8);
    assert.ok(svgTag.includes('<svg'), 'QR SVG output must contain valid SVG tag');
    assert.ok(svgTag.includes('</svg>'), 'QR SVG output must close SVG tag');
    console.log('  ✓ QR code successfully generated SVG for URL:', testQrData);
    console.log('  ✓ SVG Length:', svgTag.length, 'characters');

    console.log('\n🎉 ALL EASYDROP TESTS PASSED SUCCESSFULLY! Everything is verified.');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
