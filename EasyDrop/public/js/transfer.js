
const isReceiver = window.location.pathname.includes('receiver');

if (!isReceiver) {
    // SENDER LOGIC
    let selectedFiles = [];
    let session = new window.EasyDropSession('sender');
    let totalSize = 0;
    let sentBytes = 0;

    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const fileList = document.getElementById('file-list');
    const createBtn = document.getElementById('create-session-btn');
    
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

    function handleFiles(files) {
        selectedFiles = Array.from(files);
        totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        fileList.innerHTML = selectedFiles.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
        createBtn.disabled = selectedFiles.length === 0;
    }

    let qrTimerInterval = null;
    let qrTimeRemaining = 300; // 5 minutes

    function stopQRTimer() {
        if (qrTimerInterval) {
            clearInterval(qrTimerInterval);
            qrTimerInterval = null;
        }
        document.getElementById('qr-timer-container').style.display = 'none';
    }

    function updateTimerDisplay() {
        const timerEl = document.getElementById('qr-countdown');
        if (!timerEl) return;
        const m = Math.floor(qrTimeRemaining / 60).toString().padStart(2, '0');
        const s = (qrTimeRemaining % 60).toString().padStart(2, '0');
        timerEl.innerText = `${m}:${s}`;
        timerEl.style.color = qrTimeRemaining < 60 ? '#ef4444' : 'inherit';
    }

    function startQRTimer() {
        stopQRTimer();
        qrTimeRemaining = 300;
        updateTimerDisplay();
        document.getElementById('qr-timer-container').style.display = 'block';
        
        qrTimerInterval = setInterval(() => {
            qrTimeRemaining--;
            updateTimerDisplay();
            
            if (qrTimeRemaining <= 0) {
                stopQRTimer();
                refreshQRSession();
            }
        }, 1000);
    }

    function refreshQRSession() {
        document.getElementById('status-text').innerText = 'Refreshing session...';
        if (session) {
            session.cancelTransfer();
            if (typeof session.disconnect === 'function') session.disconnect();
        }
        session = new window.EasyDropSession('sender');
        bindSessionEvents(session);
        
        session.createSession(selectedFiles, (res) => {
            let origin = window.location.origin;
            if (res.baseUrl && (origin.includes('localhost') || origin.includes('127.0.0.1') || res.baseUrl.startsWith('https://'))) {
                origin = res.baseUrl;
            }
            const receiverUrl = `${origin}/receiver?sessionId=${res.sessionId}&token=${res.receiverToken}`;
            document.getElementById('qr-container').innerHTML = '';
            generateQR(receiverUrl, 'qr-container');
            document.getElementById('status-text').innerText = 'Waiting for receiver...';
            document.getElementById('status-text').style.color = 'inherit';
            startQRTimer();
        });
    }

    function bindSessionEvents(sess) {
        sess.onPeerJoined = () => { 
            document.getElementById('status-text').innerText = 'Receiver connected. Waiting for approval...'; 
            stopQRTimer();
        };
        sess.onAccepted = () => { document.getElementById('status-text').innerText = 'Connecting peer-to-peer...'; };
        sess.onReady = () => {
            document.getElementById('status-text').innerText = 'Ready to send';
            document.getElementById('transfer-controls').style.display = 'block';
        };
        
        sess.onProgress = (bytes) => {
            sentBytes += bytes;
            const percent = Math.min(100, Math.round((sentBytes / totalSize) * 100));
            document.getElementById('progress-fill').style.width = percent + '%';
            document.getElementById('progress-text').innerText = percent + '%';
        };

        sess.onComplete = () => {
            document.getElementById('status-text').innerText = 'Transfer Complete!';
            document.getElementById('cancel-btn').style.display = 'none';
        };
        
        sess.onDeclined = () => {
            document.getElementById('status-text').innerText = 'Transfer declined by receiver.';
            document.getElementById('status-text').style.color = 'red';
            document.getElementById('cancel-btn').style.display = 'none';
            stopQRTimer();
        };

        sess.onError = (err) => {
            document.getElementById('status-text').innerText = err;
            document.getElementById('status-text').style.color = 'red';
            document.getElementById('cancel-btn').style.display = 'none';
            stopQRTimer();
        };
    }

    bindSessionEvents(session);

    createBtn.addEventListener('click', () => {
        document.getElementById('selection-view').style.display = 'none';
        document.getElementById('qr-view').style.display = 'block';
        
        session.createSession(selectedFiles, (res) => {
            let origin = window.location.origin;
            if (res.baseUrl && (origin.includes('localhost') || origin.includes('127.0.0.1') || res.baseUrl.startsWith('https://'))) {
                origin = res.baseUrl;
            }
            const receiverUrl = `${origin}/receiver?sessionId=${res.sessionId}&token=${res.receiverToken}`;
            generateQR(receiverUrl, 'qr-container');
            startQRTimer();
        });
    });

    document.getElementById('send-files-btn').addEventListener('click', () => {
        document.getElementById('transfer-controls').style.display = 'none';
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('status-text').innerText = 'Sending files...';
        session.sendFiles();
    });

    document.getElementById('cancel-btn').addEventListener('click', () => { 
        if (session) {
            session.cancelTransfer();
            if (typeof session.disconnect === 'function') session.disconnect();
        }
        window.location.reload(); 
    });
} else {
    // RECEIVER LOGIC
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    const token = params.get('token');
    
    if (!sessionId || !token) {
        document.getElementById('status-text').innerText = 'Invalid link.';
    } else {
        let session = new window.EasyDropSession('receiver');
        let totalSize = 0;
        let receivedBytes = 0;

        session.joinSession(sessionId, token, (res) => {
            totalSize = res.files.reduce((acc, f) => acc + f.size, 0);
            document.getElementById('status-text').innerText = `Received request for ${res.files.length} files`;
            document.getElementById('file-list').innerHTML = res.files.map(f => `<div class="file-item"><span>${f.name}</span><span>${Math.round(f.size/1024)} KB</span></div>`).join('');
            document.getElementById('approval-controls').style.display = 'block';
        });

        document.getElementById('accept-btn').addEventListener('click', () => {
            document.getElementById('approval-controls').style.display = 'none';
            document.getElementById('status-text').innerText = 'Connecting peer-to-peer...';
            session.acceptTransfer();
        });
        document.getElementById('decline-btn').addEventListener('click', () => { session.declineTransfer(); window.location.href = '/'; });

        session.onReady = () => {
            document.getElementById('status-text').innerText = 'Receiving files...';
            document.getElementById('progress-container').style.display = 'block';
        };

        session.onProgress = (bytes) => {
            receivedBytes += bytes;
            const percent = Math.min(100, Math.round((receivedBytes / totalSize) * 100));
            document.getElementById('progress-fill').style.width = percent + '%';
            document.getElementById('progress-text').innerText = percent + '%';
        };

        session.onComplete = () => {
            document.getElementById('status-text').innerText = 'Transfer Complete!';
            document.getElementById('progress-container').style.display = 'none';
            document.getElementById('download-controls').style.display = 'block';
        };

        document.getElementById('download-all-btn').addEventListener('click', () => {
            const zip = new JSZip();
            session.receivedFiles.forEach(f => zip.file(f.name, f.blob));
            zip.generateAsync({type:"blob"}).then(content => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = "easydrop.zip";
                link.click();
            });
        });
        
        session.onError = (err) => {
            document.getElementById('status-text').innerText = err;
            document.getElementById('status-text').style.color = 'red';
            document.getElementById('approval-controls').style.display = 'none';
            document.getElementById('progress-container').style.display = 'none';
        };
    }
}
