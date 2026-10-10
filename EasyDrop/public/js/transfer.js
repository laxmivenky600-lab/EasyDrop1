const views = {
    mode: document.getElementById('mode-selection-view'),
    selection: document.getElementById('selection-view'),
    qr: document.getElementById('qr-view'),
    active: document.getElementById('transfer-active-view')
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
const requestedRole = params.get('role'); // 'sender' or 'receiver'

if (initialSessionId) {
    if (requestedRole === 'sender') {
        // We scanned a "Receive" QR code, we must pick files to send
        showView('selection');
        document.getElementById('create-session-btn').style.display = 'none';
        document.getElementById('send-now-btn').style.display = 'inline-block';
        document.getElementById('send-now-btn').innerText = 'Send Files';
    } else {
        // We scanned a "Send" QR code, we just join and receive
        showView('active');
        document.getElementById('transfer-heading').innerText = 'Connecting...';
        document.getElementById('transfer-subheading').innerText = 'Establishing secure connection to sender.';
        joinExistingSession(initialSessionId);
    }
} else {
    // Start at mode selection
    if (views.mode) showView('mode');
    
    document.getElementById('mode-send')?.addEventListener('click', () => {
        showView('selection');
        document.getElementById('create-session-btn').style.display = 'inline-block';
        document.getElementById('send-now-btn').style.display = 'none';
    });
    
    document.getElementById('mode-receive')?.addEventListener('click', () => {
        // We are receiving, so QR tells scanner to be 'sender'
        createSessionAndShowQR('sender');
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

// ================= SESSION CREATION =================
createBtn?.addEventListener('click', () => {
    // User picked files, clicked Create Transfer. Scanner will be 'receiver'
    createSessionAndShowQR('receiver');
});

function createSessionAndShowQR(scannerRole) {
    session = new window.EasyDropSession();
    bindSessionEvents();
    
    showView('qr');
    document.getElementById('status-text-sender').innerText = 'Creating session...';
    
    session.createSession((res) => {
        let origin = window.location.origin;
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            origin = res.baseUrl || origin;
        }
        
        const qrUrl = `${origin}/receiver?sessionId=${res.sessionId}&role=${scannerRole}`;
        
        if (document.getElementById('session-code-display')) {
            document.getElementById('session-code-display').innerText = res.sessionId;
        }
        document.getElementById('qr-container').innerHTML = '';
        generateQR(qrUrl, 'qr-container');
        document.getElementById('status-text-sender').innerText = 'Waiting for connection...';
        startQRTimer();
    });
}

// ================= SCANNER JOIN =================
function joinExistingSession(code) {
    session = new window.EasyDropSession();
    bindSessionEvents();
    
    session.joinSession(code, (res) => {
        if (res.error) {
            console.error(`[Diagnostic] Join failed: ${res.error}`);
            alert('Failed to join session: ' + res.error);
            window.location.href = '/';
            return;
        }
    });
}

// ================= SEND BUTTON (For scanner in Receive mode) =================
sendNowBtn?.addEventListener('click', () => {
    if (selectedFiles.length === 0) return;
    
    if (initialSessionId) {
        showView('active');
        document.getElementById('transfer-heading').innerText = 'Connecting...';
        document.getElementById('transfer-subheading').innerText = 'Establishing secure connection to receiver.';
        joinExistingSession(initialSessionId);
    }
});

// ================= SESSION EVENTS =================
function bindSessionEvents() {
    session.onConnectedToPeer = () => {
        stopQRTimer();
        showView('active');
        document.getElementById('connection-spinner').style.display = 'none';
        document.getElementById('connected-icon').style.display = 'flex';
        document.getElementById('transfer-heading').innerText = 'Connected!';
        document.getElementById('transfer-heading').style.color = '#16a34a';
        document.getElementById('transfer-subheading').innerText = 'Connection secured. Preparing transfer.';
        
        // If we have files picked, start sending immediately!
        if (selectedFiles.length > 0) {
            document.getElementById('active-transfer-container').style.display = 'block';
            document.getElementById('transfer-progress-title').innerText = 'Sending files...';
            session.offerFiles(selectedFiles);
            selectedFiles = []; // Clear local
        }
    };
    
    session.onTransferOffer = (filesMeta) => {
        // Auto-accept transfers based on new requirements!
        document.getElementById('active-transfer-container').style.display = 'block';
        document.getElementById('transfer-progress-title').innerText = 'Receiving files...';
        session.acceptTransfer();
    };
    
    session.onTransferProgress = (sent, total) => {
        const percent = Math.min(100, Math.round((sent / total) * 100));
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').innerText = percent + '%';
        document.getElementById('progress-detail').innerText = `${Math.round(sent/1024/1024*10)/10} MB / ${Math.round(total/1024/1024*10)/10} MB`;
    };
    
    session.onTransferComplete = () => {
        document.getElementById('active-transfer-container').style.display = 'none';
        document.getElementById('transfer-heading').style.display = 'none';
        document.getElementById('transfer-subheading').style.display = 'none';
        document.getElementById('connected-icon').style.display = 'none';
        
        document.getElementById('completion-container').style.display = 'block';
        
        if (session.receivedFiles && session.receivedFiles.length > 0) {
            document.getElementById('download-controls').style.display = 'block';
            
            // Auto download when finished
            setTimeout(() => {
                document.getElementById('download-all-btn').click();
            }, 500);
        } else {
            document.getElementById('download-controls').style.display = 'none';
        }
    };
    
    session.onTransferDeclined = () => {
        alert("Peer declined the transfer.");
        window.location.href = '/';
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

// ================= DOWNLOAD LOGIC =================
document.getElementById('download-all-btn')?.addEventListener('click', () => {
    if (!session.receivedFiles || session.receivedFiles.length === 0) return;
    
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

// ================= TIMERS =================
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
            document.getElementById('status-text-sender').innerText = 'Session expired. Please start over.';
            document.getElementById('status-text-sender').style.color = '#ef4444';
            document.getElementById('qr-container').style.opacity = '0.2';
            if (session) session.disconnect();
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
