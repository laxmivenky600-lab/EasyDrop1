const views = {
    mode: document.getElementById('mode-selection-view'),
    selection: document.getElementById('selection-view'),
    qr: document.getElementById('qr-view'),
    completion: document.getElementById('completion-view')
};

function showView(viewId) {
    Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
    if (views[viewId]) views[viewId].style.display = 'block';
}

let session = null;
let currentRole = null; // 'sender' or 'receiver'
let selectedFiles = [];
let totalSize = 0;
let sentBytes = 0;
let qrTimerInterval = null;
let qrTimeRemaining = 300; // 5 mins

const params = new URLSearchParams(window.location.search);
let sessionIdParam = params.get('sessionId');
let tokenParam = params.get('token');
let modeParam = params.get('mode'); // optional, determines if we should act as sender or receiver right away

// Check if we are joining via URL
if (sessionIdParam) {
    // If URL dictates 'send', we are sender joining a receiver-created session
    // If URL dictates 'receive' or is absent, we are receiver joining a sender-created session
    if (modeParam === 'send') {
        initAsSender(sessionIdParam, tokenParam);
    } else {
        initAsReceiver(sessionIdParam, tokenParam);
    }
} else {
    // We are starting fresh (mode selection)
    if (views.mode) showView('mode');
    
    document.getElementById('mode-send')?.addEventListener('click', () => {
        initAsSender();
    });
    
    document.getElementById('mode-receive')?.addEventListener('click', () => {
        initAsReceiver();
    });
}

// Manual Join
document.getElementById('manual-join-btn')?.addEventListener('click', () => {
    const code = document.getElementById('manual-session-code').value.trim().toUpperCase();
    if (!code) return;
    
    // If we are currently waiting as Receiver, and we type a code, we join the Sender's session as Receiver.
    // If we are currently waiting as Sender, and we type a code, we join the Receiver's session as Sender.
    // For simplicity, manual code always joins as receiver, UNLESS we are already a sender with files ready.
    if (currentRole === 'sender') {
        session.joinSession(code, null, selectedFiles, handleJoinResult);
    } else {
        session.joinSession(code, null, null, handleJoinResult);
    }
});

function handleJoinResult(res) {
    if (res.error) {
        showError(res.error);
        return;
    }
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('manual-join-container').style.display = 'none';
    stopQRTimer();
    
    if (currentRole === 'receiver') {
        handleIncomingFiles(res.files);
    } else {
        document.getElementById('status-text').innerText = 'Connected. Waiting for receiver to approve...';
    }
}

// Setup Sender Flow
function initAsSender(joinSessionId, joinToken) {
    currentRole = 'sender';
    session = new window.EasyDropSession('sender');
    bindSessionEvents();
    
    showView('selection');
    
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const fileList = document.getElementById('file-list');
    const createBtn = document.getElementById('create-session-btn');
    
    const handleFiles = (files) => {
        selectedFiles = Array.from(files);
        totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        fileList.innerHTML = selectedFiles.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
        createBtn.disabled = selectedFiles.length === 0;
    };
    
    fileInput.onchange = (e) => handleFiles(e.target.files);
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
    
    createBtn.onclick = () => {
        showView('qr');
        document.getElementById('qr-title').innerText = 'Scan to Receive Files';
        
        if (joinSessionId) {
            // We are a sender joining an existing receiver session
            session.joinSession(joinSessionId, joinToken, selectedFiles, handleJoinResult);
        } else {
            // We are a sender creating a new session
            session.createSession(selectedFiles, (res) => {
                let origin = window.location.origin;
                if (res.baseUrl && (origin.includes('localhost') || origin.includes('127.0.0.1') || res.baseUrl.startsWith('https://'))) {
                    origin = res.baseUrl;
                }
                const receiverUrl = `${origin}/receiver?sessionId=${res.sessionId}&token=${res.receiverToken}`;
                document.getElementById('session-code-display').innerText = res.sessionId;
                generateQR(receiverUrl, 'qr-container');
                startQRTimer();
            });
        }
    };
}

// Setup Receiver Flow
function initAsReceiver(joinSessionId, joinToken) {
    currentRole = 'receiver';
    session = new window.EasyDropSession('receiver');
    bindSessionEvents();
    
    showView('qr');
    document.getElementById('qr-title').innerText = 'Scan to Send Files';
    
    if (joinSessionId) {
        // Classic mode: joining a sender's session via URL
        document.getElementById('qr-container').style.display = 'none';
        document.getElementById('manual-join-container').style.display = 'none';
        session.joinSession(joinSessionId, joinToken, null, handleJoinResult);
    } else {
        // Creating a receiver session
        document.getElementById('manual-join-container').style.display = 'block';
        session.createSession(null, (res) => {
            let origin = window.location.origin;
            if (res.baseUrl && (origin.includes('localhost') || origin.includes('127.0.0.1') || res.baseUrl.startsWith('https://'))) {
                origin = res.baseUrl;
            }
            const senderUrl = `${origin}/create-transfer?mode=send&sessionId=${res.sessionId}&token=${res.senderToken}`;
            document.getElementById('session-code-display').innerText = res.sessionId;
            generateQR(senderUrl, 'qr-container');
            startQRTimer();
        });
    }
}

// UI Helpers
function startQRTimer() {
    stopQRTimer();
    qrTimeRemaining = 300;
    document.getElementById('qr-timer-container').style.display = 'block';
    updateTimerDisplay();
    qrTimerInterval = setInterval(() => {
        qrTimeRemaining--;
        updateTimerDisplay();
        if (qrTimeRemaining <= 0) {
            stopQRTimer();
            showError("Session expired. Please start over.");
        }
    }, 1000);
}

function stopQRTimer() {
    if (qrTimerInterval) clearInterval(qrTimerInterval);
    qrTimerInterval = null;
    if (document.getElementById('qr-timer-container')) {
        document.getElementById('qr-timer-container').style.display = 'none';
    }
}

function updateTimerDisplay() {
    const el = document.getElementById('qr-countdown');
    if (el) {
        el.innerText = `${Math.floor(qrTimeRemaining/60).toString().padStart(2,'0')}:${(qrTimeRemaining%60).toString().padStart(2,'0')}`;
        el.style.color = qrTimeRemaining < 60 ? '#ef4444' : 'inherit';
    }
}

function showError(err) {
    const st = document.getElementById('status-text');
    st.innerText = err;
    st.style.color = 'red';
    document.getElementById('approval-controls').style.display = 'none';
    document.getElementById('transfer-controls').style.display = 'none';
    document.getElementById('progress-container').style.display = 'none';
    stopQRTimer();
}

function handleIncomingFiles(files) {
    if (!files || files.length === 0) return;
    document.getElementById('status-text').innerText = `Received request for ${files.length} files`;
    totalSize = files.reduce((acc, f) => acc + f.size, 0);
    document.getElementById('approval-controls').style.display = 'block';
}

function bindSessionEvents() {
    session.onPeerJoined = (data) => {
        stopQRTimer();
        document.getElementById('qr-container').style.display = 'none';
        document.getElementById('manual-join-container').style.display = 'none';
        
        if (currentRole === 'sender') {
            document.getElementById('status-text').innerText = 'Receiver connected. Waiting for approval...';
        } else {
            // we are receiver, SENDER joined.
            if (data.files) handleIncomingFiles(data.files);
        }
    };
    
    session.onFilesUpdated = (files) => {
        if (currentRole === 'receiver') handleIncomingFiles(files);
    };

    session.onAccepted = () => {
        document.getElementById('status-text').innerText = 'Connecting peer-to-peer...';
        document.getElementById('approval-controls').style.display = 'none';
    };

    session.onReady = () => {
        if (currentRole === 'sender') {
            document.getElementById('status-text').innerText = 'Ready to send';
            document.getElementById('transfer-controls').style.display = 'block';
        } else {
            document.getElementById('status-text').innerText = 'Receiving files...';
            document.getElementById('progress-container').style.display = 'block';
        }
    };

    session.onProgress = (bytes) => {
        sentBytes += bytes; // applies to both sending or receiving in this simple UI
        const percent = Math.min(100, Math.round((sentBytes / totalSize) * 100));
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').innerText = percent + '%';
    };

    session.onComplete = () => {
        showView('completion');
        if (session.receivedFiles && session.receivedFiles.length > 0) {
            document.getElementById('download-controls').style.display = 'block';
        } else {
            document.getElementById('download-controls').style.display = 'none';
        }
    };

    session.onDeclined = () => showError('Transfer declined by peer.');
    session.onError = (err) => showError(err);
}

// Buttons
document.getElementById('send-files-btn')?.addEventListener('click', () => {
    document.getElementById('transfer-controls').style.display = 'none';
    document.getElementById('progress-container').style.display = 'block';
    document.getElementById('status-text').innerText = 'Sending files...';
    sentBytes = 0; // reset for this batch
    session.sendFiles();
});

document.getElementById('accept-btn')?.addEventListener('click', () => {
    document.getElementById('approval-controls').style.display = 'none';
    document.getElementById('status-text').innerText = 'Connecting peer-to-peer...';
    sentBytes = 0;
    session.acceptTransfer();
});

document.getElementById('decline-btn')?.addEventListener('click', () => {
    session.declineTransfer();
    window.location.href = '/';
});

document.getElementById('cancel-btn')?.addEventListener('click', () => {
    if (session) {
        session.cancelTransfer();
        session.disconnect();
    }
    window.location.reload();
});

document.getElementById('download-all-btn')?.addEventListener('click', () => {
    if (!session.receivedFiles || session.receivedFiles.length === 0) return;
    if (session.receivedFiles.length === 1) {
        // Single file download
        const f = session.receivedFiles[0];
        const link = document.createElement('a');
        link.href = URL.createObjectURL(f.blob);
        link.download = f.name;
        link.click();
    } else {
        // Zip multiple
        const zip = new JSZip();
        session.receivedFiles.forEach(f => zip.file(f.name, f.blob));
        zip.generateAsync({type:"blob"}).then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = "easydrop.zip";
            link.click();
        });
    }
});

// Switch Direction / Send Files Back
document.getElementById('send-back-btn')?.addEventListener('click', () => {
    // We already have an established WebRTC channel.
    // The user wants to send files now. We just show the file selection view, but we are ALREADY connected!
    showView('selection');
    document.getElementById('create-session-btn').innerText = 'Send Files Now';
    document.getElementById('create-session-btn').onclick = () => {
        showView('qr'); // Reuse qr view as the transfer active view
        document.getElementById('qr-title').innerText = 'Sending Files Back';
        document.getElementById('qr-container').style.display = 'none';
        document.getElementById('manual-join-container').style.display = 'none';
        stopQRTimer();
        
        document.getElementById('transfer-controls').style.display = 'none';
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('status-text').innerText = 'Sending files...';
        
        sentBytes = 0;
        session.sendFiles(selectedFiles);
    };
});
