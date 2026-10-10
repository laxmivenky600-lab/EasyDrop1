const views = {
    mode: document.getElementById('mode-selection-view'),
    selection: document.getElementById('selection-view'),
    join: document.getElementById('join-view'),
    qr: document.getElementById('qr-view'),
    lobby: document.getElementById('lobby-view')
};

function showView(viewId) {
    Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
    if (views[viewId]) views[viewId].style.display = 'block';
}

let session = null;
let selectedFiles = [];
let qrTimerInterval = null;
let qrTimeRemaining = 300;

const params = new URLSearchParams(window.location.search);
const initialSessionId = params.get('sessionId');

if (initialSessionId) {
    // If opened via QR code link, start as receiver joining the session immediately
    showView('join');
    joinExistingSession(initialSessionId);
} else {
    // Start at mode selection
    if (views.mode) showView('mode');
    
    document.getElementById('mode-send')?.addEventListener('click', () => {
        showView('selection');
        document.getElementById('create-session-btn').style.display = 'inline-block';
        document.getElementById('send-now-btn').style.display = 'none';
        document.getElementById('cancel-selection-btn').style.display = 'none';
    });
    
    document.getElementById('mode-receive')?.addEventListener('click', () => {
        showView('join');
    });
}

// ================= FILE SELECTION LOGIC =================
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const fileList = document.getElementById('file-list');
const createBtn = document.getElementById('create-session-btn');
const sendNowBtn = document.getElementById('send-now-btn');

function handleFiles(files) {
    selectedFiles = Array.from(files);
    fileList.innerHTML = selectedFiles.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
    
    if (selectedFiles.length > 0) {
        createBtn.disabled = false;
        sendNowBtn.disabled = false;
    } else {
        createBtn.disabled = true;
        sendNowBtn.disabled = true;
    }
}

fileInput?.addEventListener('change', (e) => handleFiles(e.target.files));
dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone?.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

// ================= SENDER CREATES SESSION =================
createBtn?.addEventListener('click', () => {
    session = new window.EasyDropSession();
    bindSessionEvents();
    
    showView('qr');
    document.getElementById('status-text-sender').innerText = 'Creating session...';
    
    session.createSession((res) => {
        console.log(`[Diagnostic] Session created: ${res.sessionId}`);
        
        let origin = window.location.origin;
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            origin = res.baseUrl || origin;
        }
        
        const qrUrl = `${origin}/receiver?sessionId=${res.sessionId}`;
        console.log(`[Diagnostic] QR URL: ${qrUrl}`);
        
        document.getElementById('session-code-display').innerText = res.sessionId;
        document.getElementById('qr-container').innerHTML = '';
        generateQR(qrUrl, 'qr-container');
        document.getElementById('status-text-sender').innerText = 'Waiting for receiver to connect...';
        startQRTimer();
    });
});

// ================= RECEIVER JOINS SESSION =================
document.getElementById('manual-join-btn')?.addEventListener('click', () => {
    const code = document.getElementById('manual-session-code').value.trim().toUpperCase();
    if (!code) return;
    joinExistingSession(code);
});

function joinExistingSession(code) {
    document.getElementById('join-error-text').style.display = 'none';
    if (document.getElementById('join-instructions-container')) document.getElementById('join-instructions-container').style.display = 'none';
    if (document.getElementById('join-loading-container')) document.getElementById('join-loading-container').style.display = 'block';
    
    session = new window.EasyDropSession();
    bindSessionEvents();
    
    session.joinSession(code, (res) => {
        if (res.error) {
            console.error(`[Diagnostic] Join failed: ${res.error}`);
            if (document.getElementById('join-instructions-container')) document.getElementById('join-instructions-container').style.display = 'block';
            if (document.getElementById('join-loading-container')) document.getElementById('join-loading-container').style.display = 'none';
            document.getElementById('join-error-text').innerText = res.error;
            document.getElementById('join-error-text').style.display = 'block';
            return;
        }
        console.log(`[Diagnostic] Joined session via code, waiting for WebRTC channel...`);
    });
}

// ================= SESSION EVENTS & LOBBY =================
function bindSessionEvents() {
    session.onConnectedToPeer = () => {
        console.log(`[Diagnostic] Connected to peer successfully!`);
        stopQRTimer();
        showView('lobby');
        resetLobbyUI();
        
        // If we had files picked (e.g. we are the sender who just created), offer them immediately!
        if (selectedFiles.length > 0 && session.role === 'creator') {
            document.getElementById('active-transfer-container').style.display = 'block';
            document.getElementById('transfer-heading').innerText = 'Asking peer for permission...';
            session.offerFiles(selectedFiles);
            selectedFiles = []; // Clear local so we don't double send if they go back
        }
    };
    
    session.onTransferOffer = (filesMeta) => {
        console.log(`[Diagnostic] Received transfer offer`);
        document.getElementById('incoming-request-container').style.display = 'block';
        const totalSize = filesMeta.reduce((acc, f) => acc + f.size, 0);
        document.getElementById('incoming-status-text').innerText = `Peer wants to send ${filesMeta.length} file(s) (${Math.round(totalSize/1024)} KB).`;
    };
    
    session.onTransferProgress = (sent, total) => {
        document.getElementById('incoming-request-container').style.display = 'none';
        document.getElementById('active-transfer-container').style.display = 'block';
        document.getElementById('transfer-heading').innerText = 'Transferring files...';
        
        const percent = Math.min(100, Math.round((sent / total) * 100));
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').innerText = percent + '%';
    };
    
    session.onTransferComplete = () => {
        console.log(`[Diagnostic] Transfer Complete`);
        document.getElementById('active-transfer-container').style.display = 'none';
        document.getElementById('completion-container').style.display = 'block';
        
        if (session.receivedFiles && session.receivedFiles.length > 0) {
            document.getElementById('download-controls').style.display = 'block';
        } else {
            document.getElementById('download-controls').style.display = 'none';
        }
    };
    
    session.onTransferDeclined = () => {
        alert("Peer declined the transfer.");
        resetLobbyUI();
    };
    
    session.onPeerDisconnected = () => {
        alert("Peer disconnected.");
        window.location.href = '/';
    };
    
    session.onError = (err) => {
        console.error(`[Diagnostic] Session error: ${err}`);
        alert(`Error: ${err}`);
        if (!session.channel || session.channel.readyState !== 'open') {
            window.location.href = '/';
        }
    };
}

// ================= LOBBY ACTIONS =================
function resetLobbyUI() {
    document.getElementById('incoming-request-container').style.display = 'none';
    document.getElementById('active-transfer-container').style.display = 'none';
    document.getElementById('completion-container').style.display = 'none';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').innerText = '0%';
}

document.getElementById('lobby-send-btn')?.addEventListener('click', () => {
    // Show file selection over the lobby
    showView('selection');
    document.getElementById('create-session-btn').style.display = 'none';
    document.getElementById('send-now-btn').style.display = 'inline-block';
    document.getElementById('cancel-selection-btn').style.display = 'inline-block';
    
    // Clear previous
    selectedFiles = [];
    fileList.innerHTML = '';
    sendNowBtn.disabled = true;
});

document.getElementById('cancel-selection-btn')?.addEventListener('click', () => {
    showView('lobby');
});

sendNowBtn?.addEventListener('click', () => {
    if (selectedFiles.length === 0) return;
    showView('lobby');
    resetLobbyUI();
    document.getElementById('active-transfer-container').style.display = 'block';
    document.getElementById('transfer-heading').innerText = 'Asking peer for permission...';
    session.offerFiles(selectedFiles);
});

document.getElementById('accept-btn')?.addEventListener('click', () => {
    document.getElementById('incoming-request-container').style.display = 'none';
    document.getElementById('active-transfer-container').style.display = 'block';
    document.getElementById('transfer-heading').innerText = 'Receiving files...';
    session.acceptTransfer();
});

document.getElementById('decline-btn')?.addEventListener('click', () => {
    document.getElementById('incoming-request-container').style.display = 'none';
    session.declineTransfer();
});

document.getElementById('lobby-disconnect-btn')?.addEventListener('click', () => {
    if (session) session.disconnect();
    window.location.href = '/';
});

document.getElementById('dismiss-completion-btn')?.addEventListener('click', () => {
    document.getElementById('completion-container').style.display = 'none';
});

// ================= DOWNLOAD LOGIC =================
document.getElementById('download-all-btn')?.addEventListener('click', () => {
    if (!session.receivedFiles || session.receivedFiles.length === 0) return;
    
    // If only one file was received, download it directly without zipping
    if (session.receivedFiles.length === 1) {
        const f = session.receivedFiles[0];
        const link = document.createElement('a');
        link.href = URL.createObjectURL(f.blob);
        link.download = f.name;
        link.click();
        return;
    }
    
    const zip = new JSZip();
    session.receivedFiles.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(content => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = "easydrop.zip";
        link.click();
    });
});

// ================= TIMERS & HELPERS =================
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
            document.getElementById('status-text-sender').innerText = 'Session expired. Please restart.';
            document.getElementById('status-text-sender').style.color = 'red';
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

document.getElementById('cancel-session-btn')?.addEventListener('click', () => {
    if (session) session.disconnect();
    window.location.reload();
});
