/**
 * EasyDrop QR Code Generator
 * Reliable SVG/Image QR generator with validation and error handling.
 */

function generateQR(data, elementId) {
    return new Promise((resolve, reject) => {
        try {
            if (!data || typeof data !== 'string' || data.trim().length === 0) {
                throw new Error('Cannot generate QR code for empty data.');
            }

            const container = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
            if (!container) {
                throw new Error(`QR container element #${elementId} not found in DOM.`);
            }

            if (typeof qrcode !== 'function') {
                throw new Error('QR code generator library (qrcode) is not available.');
            }

            // 0 auto-detects version, 'M' provides ~15% error correction
            const qr = qrcode(0, 'M');
            qr.addData(data.trim());
            qr.make();

            // Create SVG for maximum crispness across high-DPI desktop and mobile screens
            const svgString = qr.createSvgTag(6, 8);
            container.innerHTML = svgString;

            const svgElement = container.querySelector('svg');
            if (svgElement) {
                svgElement.setAttribute('role', 'img');
                svgElement.setAttribute('aria-label', 'Session pairing QR code');
                svgElement.style.maxWidth = '240px';
                svgElement.style.maxHeight = '240px';
                svgElement.style.width = '100%';
                svgElement.style.height = 'auto';
                svgElement.style.display = 'block';
                svgElement.style.margin = '0 auto';
                svgElement.style.borderRadius = '8px';
                svgElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                svgElement.style.backgroundColor = '#ffffff';
                svgElement.style.padding = '8px';
            }

            resolve(container);
        } catch (err) {
            console.error('[EasyDrop QR] Generation failed:', err);
            const container = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
            if (container) {
                container.innerHTML = `<div class="qr-error-box" style="padding: 16px; border: 1px solid #fecaca; background: #fef2f2; border-radius: 8px; color: #dc2626; font-size: 14px;">
                    <strong>QR Generation Failed</strong>
                    <p style="margin: 4px 0 0 0; font-size: 13px;">${err.message || 'Unknown error'}</p>
                </div>`;
            }
            reject(err);
        }
    });
}

window.generateQR = generateQR;
