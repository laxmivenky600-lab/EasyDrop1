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
let isCreatingSession = false;
let currentScannerRole = 'receiver';
let activeTransferRole = null; // 'sender' or 'receiver'

const params = new URLSearchParams(window.location.search);
const initialSessionId = params.get('sessionId') || params.get('id');
const requestedRole = params.get('role'); // 'receiver' (scanned Send QR) or 'sender' (scanned Receive QR)

// ================= ROUTING & INITIAL STATE =================
if (initialSessionId) {
    // USER 2: Scanned QR code, connecting automatically
    if (requestedRole === 'sender') {
        // User 2 scanned a "Receive" QR code -> User 2 selects files to send
        activeTransferRole = 'sender';
        showView('selection');
        const selTitle = document.getElementById('selection-title');
        const selSubtitle = document.getElementById('selection-subtitle');
        const createSessionBtn = document.getElementById('create-session-btn');
        const sendNowBtnEl = document.getElementById('send-now-btn');

        if (selTitle) selTitle.innerText = 'Select files to send';
        if (selSubtitle) selSubtitle.innerText = 'Choose files to transfer to the connected receiver.';
        if (createSessionBtn) createSessionBtn.style.display = 'none';
        if (sendNowBtnEl) {
            sendNowBtnEl.style.display = 'inline-block';
            sendNowBtnEl.innerText = 'Send Files';
        }

        // Connect in the background so peer connection is ready when files are sent
        connectToScannedSession(initialSessionId, 'sender');

    } else {
        // User 2 scanned a "Send" QR code -> User 2 will receive files automatically
        activeTransferRole = 'receiver';
        showView('active');
        setConnectionStatus('Connected', 'Connecting to sender...');
        connectToScannedSession(initialSessionId, 'receiver');
    }
} else {
    // USER 1: Starts at Home Screen showing ONLY Send and Receive
    if (views.mode) showView('mode');

    document.getElementById('mode-send')?.addEventListener('click', () => {
        // SEND flow step 1: User 1 taps Send and selects files
        activeTransferRole = 'sender';
        showView('selection');
        const selTitle = document.getElementById('selection-title');
        const selSubtitle = document.getElementById('selection-subtitle');
        const createSessionBtn = document.getElementById('create-session-btn');
        const sendNowBtnEl = document.getElementById('send-now-btn');

        if (selTitle) selTitle.innerText = 'Select files to share';
        if (selSubtitle) selSubtitle.innerText = 'Choose files to transfer to the receiver.';
        if (createSessionBtn) {
            createSessionBtn.style.display = 'inline-block';
            createSessionBtn.innerText = 'Generate QR Code';
        }
        if (sendNowBtnEl) sendNowBtnEl.style.display = 'none';
    });

    document.getElementById('mode-receive')?.addEventListener('click', () => {
        // RECEIVE flow step 1: User 1 taps Receive -> QR code generated immediately
        activeTransferRole = 'receiver';
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
    if (fileList) {
        fileList.innerHTML = selectedFiles.map(f => `
            <div class="file-item">
                <span>${f.name}</span>
                <span>${formatBytes(f.size)}</span>
            </div>
        `).join('');
    }

    const hasFiles = selectedFiles.length > 0;
    if (createBtn) createBtn.disabled = !hasFiles;
    if (sendNowBtn) sendNowBtn.disabled = !hasFiles;
}

fileInput?.addEventListener('change', (e) => handleFiles(e.target.files));
dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

// User 1 in Send flow clicks "Generate QR Code"
createBtn?.addEventListener('click', () => {
    createSessionAndShowQR('receiver');
});

// User 2 in Receive flow clicks "Send Files"
sendNowBtn?.addEventListener('click', () => {
    if (selectedFiles.length === 0) return;
    showView('active');

    if (session && session.channel && session.channel.readyState === 'open') {
        // Channel already connected, send files immediately
        startFileTransfer();
    } else {
        // Channel opening, wait for onConnectedToPeer
        setConnectionStatus('Connected', 'Connecting to receiver...');
    }
});

// ================= SESSION CREATION & QR GENERATION =================
function getPublicAppUrl(sessionId, scannerRole, serverBaseUrl) {
    let origin = window.location.origin;

    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    if (isLocalhost) {
        if (serverBaseUrl && !serverBaseUrl.includes('localhost') && !serverBaseUrl.includes('127.0.0.1')) {
            origin = serverBaseUrl;
        }
    } else {
        if (origin.startsWith('http://') && !origin.includes(':')) {
            origin = origin.replace('http://', 'https://');
        }
    }

    return `${origin}/session?sessionId=${encodeURIComponent(sessionId)}&role=${encodeURIComponent(scannerRole)}`;
}

async function createSessionAndShowQR(scannerRole) {
    if (isCreatingSession) return;
    isCreatingSession = true;
    currentScannerRole = scannerRole;

    showView('qr');

    const creatingContainer = document.getElementById('qr-creating-container');
    const errorContainer = document.getElementById('qr-error-container');
    const successContainer = document.getElementById('qr-success-container');

    if (creatingContainer) creatingContainer.style.display = 'block';
    if (errorContainer) errorContainer.style.display = 'none';
    if (successContainer) successContainer.style.display = 'none';

    stopQRTimer();
    if (createBtn) createBtn.disabled = true;

    if (session) {
        session.cancelSession();
        session = null;
    }

    session = new window.EasyDropSession();
    bindSessionEvents();

    const creatorRole = scannerRole === 'receiver' ? 'sender' : 'receiver';

    try {
        const res = await session.createSession(creatorRole);
        isCreatingSession = false;
        if (createBtn && selectedFiles.length > 0) createBtn.disabled = false;

        if (!res || res.error || !res.sessionId) {
            throw new Error((res && res.error) || 'Failed to create a session on the server.');
        }

        // Show QR success state
        if (creatingContainer) creatingContainer.style.display = 'none';
        if (errorContainer) errorContainer.style.display = 'none';
        if (successContainer) successContainer.style.display = 'block';

        const qrTitle = document.getElementById('qr-title');
        const qrSubtitle = document.getElementById('qr-subtitle');
        if (qrTitle) qrTitle.innerText = 'Scan to Connect';
        if (qrSubtitle) {
            if (creatorRole === 'sender') {
                qrSubtitle.innerText = 'Ask the receiver to scan this QR code to connect and receive files.';
            } else {
                qrSubtitle.innerText = 'Ask the sender to scan this QR code to connect and send files.';
            }
        }

        // Generate QR code pointing to session URL
        const qrUrl = getPublicAppUrl(res.sessionId, scannerRole, res.baseUrl);
        console.log('[EasyDrop] Pairing QR URL:', qrUrl);

        const qrContainer = document.getElementById('qr-container');
        if (qrContainer) qrContainer.innerHTML = '';
        await window.generateQR(qrUrl, 'qr-container');

        if (qrContainer) {
            qrContainer.classList.remove('qr-animate-in');
            void qrContainer.offsetWidth;
            qrContainer.classList.add('qr-animate-in');
        }

        const qrWrapper = document.getElementById('qr-wrapper');
        if (qrWrapper) {
            qrWrapper.classList.add('active');
            qrWrapper.classList.remove('expired');
        }

        // Status is "Waiting for scan"
        setConnectionStatus('Waiting for scan', 'Ask device 2 to scan the QR code above.');

        const expiredActions = document.getElementById('qr-expired-actions');
        if (expiredActions) expiredActions.style.display = 'none';

        // 5-minute expiry timer
        const durationSeconds = typeof res.expiresIn === 'number' && res.expiresIn > 0 ? res.expiresIn : 300;
        startQRTimer(durationSeconds);

    } catch (err) {
        isCreatingSession = false;
        if (createBtn && selectedFiles.length > 0) createBtn.disabled = false;
        console.error('[EasyDrop] Session creation error:', err);
        handleSessionError(err.message || 'Unable to establish a secure session with the server.');
    }
}

// ================= AUTOMATIC SCANNER CONNECT =================
function connectToScannedSession(sessionId, role) {
    if (session) {
        session.disconnect();
    }
    session = new window.EasyDropSession();
    bindSessionEvents();

    session.joinSession(sessionId, role, (res) => {
        if (res.error) {
            console.error(`[EasyDrop] Automatic join failed: ${res.error}`);
            handleSessionError('Scan failed or session expired. Please ask the other device to generate a new QR code.');
        }
    });
}

// ================= CONNECTION STATUS & PROGRESS HELPERS =================
function setConnectionStatus(statusName, details = '') {
    // "Waiting for scan", "Connected", "Transferring", "Completed"
    const senderBadgeText = document.getElementById('status-text-sender');
    if (senderBadgeText) senderBadgeText.innerText = statusName;

    const pillText = document.getElementById('status-pill-text');
    const pillDot = document.getElementById('status-pill-dot');
    if (pillText) pillText.innerText = statusName;

    const heading = document.getElementById('transfer-heading');
    const subheading = document.getElementById('transfer-subheading');
    if (heading) heading.innerText = statusName;
    if (subheading && details) subheading.innerText = details;

    if (pillDot) {
        if (statusName === 'Waiting for scan') pillDot.style.background = '#4f46e5';
        else if (statusName === 'Connected') pillDot.style.background = '#16a34a';
        else if (statusName === 'Transferring') pillDot.style.background = '#2563eb';
        else if (statusName === 'Completed') pillDot.style.background = '#16a34a';
    }
}

function startFileTransfer() {
    if (selectedFiles.length === 0) return;
    setConnectionStatus('Transferring', 'Sending files directly to peer...');

    const activeTransfer = document.getElementById('active-transfer-container');
    const progressTitle = document.getElementById('transfer-progress-title');
    if (activeTransfer) activeTransfer.style.display = 'block';
    if (progressTitle) progressTitle.innerText = 'Transferring';

    session.offerFiles(selectedFiles);
    selectedFiles = []; // Cleared after offer initiated
}

// ================= SESSION EVENTS & WEBRTC LIFECYCLE =================
function bindSessionEvents() {
    session.onConnectedToPeer = () => {
        stopQRTimer();
        showView('active');

        const dots = document.getElementById('connecting-dots');
        if (dots) dots.style.display = 'none';

        const line = document.getElementById('connected-line');
        if (line) {
            line.style.display = 'block';
            line.classList.add('draw-line-anim');
        }

        const icon = document.getElementById('connected-icon-anim');
        if (icon) {
            icon.style.display = 'flex';
            icon.classList.add('pop-check-anim');
        }

        setConnectionStatus('Connected', 'Connection secured between both devices.');

        // If files are already selected (e.g. User 1 in Send flow), transfer starts automatically!
        if (selectedFiles.length > 0) {
            startFileTransfer();
        } else if (activeTransferRole === 'receiver') {
            setConnectionStatus('Connected', 'Connected! Waiting for sender to select files.');
        }
    };

    session.onTransferOffer = () => {
        // Both devices connect automatically, and transfer starts automatically with NO extra confirmation button!
        setConnectionStatus('Transferring', 'Receiving files directly from peer...');
        const activeTransfer = document.getElementById('active-transfer-container');
        const progressTitle = document.getElementById('transfer-progress-title');
        if (activeTransfer) activeTransfer.style.display = 'block';
        if (progressTitle) progressTitle.innerText = 'Transferring';

        session.acceptTransfer();
    };

    session.onTransferProgress = (sent, total, fileName, currentFileBytes, currentFileSize) => {
        const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressText) progressText.innerText = percent + '%';

        const currentFileNameEl = document.getElementById('current-file-name');
        if (currentFileNameEl && fileName) currentFileNameEl.innerText = fileName;

        if (currentFileSize) {
            const currentPercent = Math.min(100, Math.round((currentFileBytes / currentFileSize) * 100));
            const currentProgressEl = document.getElementById('current-file-progress');
            const progressDetailEl = document.getElementById('progress-detail');
            if (currentProgressEl) currentProgressEl.innerText = `${currentPercent}%`;
            if (progressDetailEl) progressDetailEl.innerText = `${formatBytes(currentFileBytes)} of ${formatBytes(currentFileSize)}`;
        }

        const overallTextEl = document.getElementById('overall-files-text');
        if (overallTextEl) overallTextEl.innerText = `Overall: ${formatBytes(sent)} / ${formatBytes(total)}`;
    };

    session.onTransferComplete = () => {
        setConnectionStatus('Completed', 'All files were transferred successfully.');

        const activeTransfer = document.getElementById('active-transfer-container');
        const transferHeading = document.getElementById('transfer-heading');
        const transferSubheading = document.getElementById('transfer-subheading');
        const connAnim = document.getElementById('connection-animation');
        const completionContainer = document.getElementById('completion-container');

        if (activeTransfer) activeTransfer.style.display = 'none';
        if (transferHeading) transferHeading.style.display = 'none';
        if (transferSubheading) transferSubheading.style.display = 'none';
        if (connAnim) connAnim.style.display = 'none';
        if (completionContainer) completionContainer.style.display = 'block';

        const filesCount = session.pendingFiles && session.pendingFiles.length
            ? session.pendingFiles.length
            : (session.receivedFiles ? session.receivedFiles.length : 0);

        let totalSize = 0;
        if (session.pendingFiles && session.pendingFiles.length > 0) {
            totalSize = session.pendingFiles.reduce((acc, f) => acc + f.size, 0);
        } else if (session.receivedFiles) {
            totalSize = session.receivedFiles.reduce((acc, f) => acc + f.blob.size, 0);
        }

        const summaryEl = document.getElementById('completion-summary');
        if (summaryEl) {
            summaryEl.innerText = `Successfully transferred ${filesCount} file${filesCount !== 1 ? 's' : ''} (${formatBytes(totalSize)})`;
        }

        shootConfetti();

        const downloadControls = document.getElementById('download-controls');
        if (session.receivedFiles && session.receivedFiles.length > 0) {
            if (downloadControls) downloadControls.style.display = 'block';
            setTimeout(() => {
                document.getElementById('download-all-btn')?.click();
            }, 600);
        } else {
            if (downloadControls) downloadControls.style.display = 'none';
        }
    };

    session.onTransferDeclined = () => {
        alert('Transfer was declined.');
        cancelAndReset();
    };

    session.onPeerDisconnected = () => {
        handleSessionError('Connection lost. The other device disconnected.');
    };

    session.onError = (err) => {
        handleSessionError(err || 'A connection error occurred.');
    };
}

// ================= ERROR HANDLING & RETRY =================
function handleSessionError(message) {
    console.error('[EasyDrop] Error:', message);
    stopQRTimer();

    const creatingContainer = document.getElementById('qr-creating-container');
    const successContainer = document.getElementById('qr-success-container');
    const errorContainer = document.getElementById('qr-error-container');
    if (creatingContainer) creatingContainer.style.display = 'none';
    if (successContainer) successContainer.style.display = 'none';
    if (errorContainer) {
        errorContainer.style.display = 'block';
        const errorText = document.getElementById('qr-error-text');
        if (errorText) errorText.innerText = message || 'Session creation failed.';
    }

    const retryBox = document.getElementById('connection-retry');
    const errorMsg = document.getElementById('connection-error-msg');
    const transferHeading = document.getElementById('transfer-heading');
    const transferSubheading = document.getElementById('transfer-subheading');
    const dots = document.getElementById('connecting-dots');

    if (retryBox) {
        retryBox.style.display = 'block';
        if (errorMsg) errorMsg.innerText = message || 'Connection lost. Please try again.';
    }
    if (transferHeading) {
        transferHeading.innerText = 'Connection Error';
        transferHeading.style.color = '#ef4444';
    }
    if (transferSubheading) {
        transferSubheading.innerText = message || 'Unable to establish connection.';
    }
    if (dots) dots.style.display = 'none';
}

// ================= DOWNLOAD LOGIC =================
document.getElementById('download-all-btn')?.addEventListener('click', () => {
    if (!session || !session.receivedFiles || session.receivedFiles.length === 0) return;

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
    zip.generateAsync({ type: 'blob' }).then(content => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'easydrop-files.zip';
        link.click();
    });
});

// ================= QR COUNTDOWN TIMER =================
function startQRTimer(seconds = 300) {
    stopQRTimer();
    qrTimeRemaining = typeof seconds === 'number' && seconds > 0 ? seconds : 300;

    const timerContainer = document.getElementById('qr-timer-container');
    if (timerContainer) timerContainer.style.display = 'block';
    updateTimerDisplay();

    qrTimerInterval = setInterval(() => {
        qrTimeRemaining--;
        updateTimerDisplay();

        if (qrTimeRemaining <= 0) {
            stopQRTimer();
            setConnectionStatus('QR Code Expired', 'The QR code has expired. Please generate a new one.');

            const qrWrapper = document.getElementById('qr-wrapper');
            if (qrWrapper) qrWrapper.classList.add('expired');

            const expiredActions = document.getElementById('qr-expired-actions');
            if (expiredActions) expiredActions.style.display = 'block';

            if (session && !session.channel) {
                session.disconnect();
            }
        }
    }, 1000);
}

function stopQRTimer() {
    if (qrTimerInterval) {
        clearInterval(qrTimerInterval);
        qrTimerInterval = null;
    }
}

function updateTimerDisplay() {
    const el = document.getElementById('qr-countdown');
    if (el) {
        const mins = Math.floor(Math.max(0, qrTimeRemaining) / 60).toString().padStart(2, '0');
        const secs = (Math.max(0, qrTimeRemaining) % 60).toString().padStart(2, '0');
        el.innerText = `${mins}:${secs}`;
        el.style.color = qrTimeRemaining < 60 ? '#ef4444' : 'inherit';
    }
}

// ================= RESET & CANCELLATION =================
function cancelAndReset() {
    stopQRTimer();
    if (session) {
        session.cancelSession();
        session = null;
    }
    isCreatingSession = false;
    selectedFiles = [];
    activeTransferRole = null;

    if (window.location.search) {
        // If URL had query params from scanning, return cleanly to home
        window.location.href = '/';
        return;
    }

    // Reset view to Home Screen (Send / Receive only)
    showView('mode');
}

document.getElementById('cancel-session-btn')?.addEventListener('click', cancelAndReset);
document.getElementById('cancel-creating-btn')?.addEventListener('click', cancelAndReset);
document.getElementById('cancel-error-btn')?.addEventListener('click', cancelAndReset);
document.getElementById('cancel-selection-btn')?.addEventListener('click', cancelAndReset);
document.getElementById('share-more-btn')?.addEventListener('click', cancelAndReset);
document.getElementById('retry-conn-btn')?.addEventListener('click', cancelAndReset);

document.getElementById('retry-session-btn')?.addEventListener('click', () => {
    createSessionAndShowQR(currentScannerRole);
});
document.getElementById('generate-new-qr-btn')?.addEventListener('click', () => {
    createSessionAndShowQR(currentScannerRole);
});

function shootConfetti() {
    const colors = ['🎉', '✨', '🎊', '🎈', '⭐'];
    const container = document.getElementById('completion-container');
    if (!container) return;

    for (let i = 0; i < 35; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.innerText = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDuration = (Math.random() * 1.5 + 1.5) + 's';
        confetti.style.animationDelay = (Math.random() * 0.5) + 's';
        container.appendChild(confetti);
        setTimeout(() => confetti.remove(), 3500);
    }
}

function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
