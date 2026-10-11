const assert = require('assert');
const { io } = require('socket.io-client');

const BASE_URL = 'http://localhost:3000';

async function testDirection(creatorRole, scannerRole) {
    console.log(`\nTesting Transfer Direction: Creator=${creatorRole}, Joiner=${scannerRole}`);
    
    // 1. Create session via REST
    const createRes = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: creatorRole, files: [] })
    });
    assert.strictEqual(createRes.status, 201);
    const sessionData = await createRes.json();
    const sessionId = sessionData.sessionId;
    assert.ok(sessionId.startsWith('ED-'));

    // 2. Connect sockets
    await new Promise((resolve, reject) => {
        const creatorSocket = io(BASE_URL);
        const joinerSocket = io(BASE_URL);

        let offerReceived = false;
        let answerReceived = false;
        let iceCandidateReceived = false;

        creatorSocket.on('connect', () => {
            const token = creatorRole === 'sender' ? sessionData.senderToken : sessionData.receiverToken;
            creatorSocket.emit('join-session', { sessionId, role: creatorRole, token }, (res) => {
                assert.ok(res.success, 'Creator join succeeded');

                // Creator listens for joiner
                creatorSocket.on('peer-joined', ({ role }) => {
                    assert.strictEqual(role, scannerRole);
                    console.log(`  ✓ Creator received peer-joined for ${role}`);

                    // Simulate WebRTC Signaling
                    creatorSocket.emit('offer', { sessionId, sdp: { type: 'offer', sdp: 'dummy-offer-sdp' } });
                });

                // Joiner joins now
                joinerSocket.emit('join-session', { sessionId, role: scannerRole, token: null }, (joinRes) => {
                    assert.ok(joinRes.success, 'Joiner join succeeded');
                    console.log(`  ✓ Joiner joined as ${scannerRole}`);
                });
            });
        });

        joinerSocket.on('offer', ({ sdp }) => {
            offerReceived = true;
            assert.strictEqual(sdp.type, 'offer');
            console.log('  ✓ Joiner received WebRTC offer');
            joinerSocket.emit('answer', { sessionId, sdp: { type: 'answer', sdp: 'dummy-answer-sdp' } });
        });

        creatorSocket.on('answer', ({ sdp }) => {
            answerReceived = true;
            assert.strictEqual(sdp.type, 'answer');
            console.log('  ✓ Creator received WebRTC answer');
            creatorSocket.emit('ice-candidate', { sessionId, candidate: { candidate: 'candidate:1 1 UDP ...' } });
        });

        joinerSocket.on('ice-candidate', ({ candidate }) => {
            iceCandidateReceived = true;
            assert.ok(candidate.candidate);
            console.log('  ✓ Joiner received ICE candidate');

            const receiverSocket = creatorRole === 'receiver' ? creatorSocket : joinerSocket;
            receiverSocket.emit('accept', { sessionId });
        });

        const senderSocket = creatorRole === 'sender' ? creatorSocket : joinerSocket;
        senderSocket.on('accept', () => {
            console.log('  ✓ Sender received transfer accept signal');
            senderSocket.emit('complete', { sessionId });
            
            setTimeout(() => {
                creatorSocket.disconnect();
                joinerSocket.disconnect();
                assert.ok(offerReceived && answerReceived && iceCandidateReceived);
                resolve();
            }, 100);
        });

        creatorSocket.on('connect_error', reject);
        joinerSocket.on('connect_error', reject);
    });
}

async function run() {
    // Test Direction 1: Send Mode (Device 1 creates as sender, Device 2 joins as receiver)
    await testDirection('sender', 'receiver');
    // Test Direction 2: Receive Mode (Device 1 creates as receiver, Device 2 joins as sender)
    await testDirection('receiver', 'sender');
    console.log('\n🎉 BOTH TRANSFER DIRECTIONS FULLY VERIFIED!');
}

run().catch(e => {
    console.error('Failed:', e);
    process.exit(1);
});
