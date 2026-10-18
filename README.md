# Visor Browser · Computer-to-glasses prototype

A separate, experimental screen viewer for **Meta Ray-Ban Display**. It does **not** modify Visor Gallery.

## App links
- Computer controller: https://deepanshusharma-bnb.github.io/meta-browser/computer.html
- Glasses viewer: https://deepanshusharma-bnb.github.io/meta-browser/glasses.html
- Homepage: https://deepanshusharma-bnb.github.io/meta-browser/

**GitHub Pages must be enabled for this repository:** Settings → Pages → Source: **GitHub Actions**.

## Use
1. Add the glasses URL as a Web App in the Meta AI app under Display Glasses settings → App connections → Web apps.
2. Open it in your glasses. It displays a 12-character pairing code.
3. Open the computer controller in desktop Chrome or Edge. Enter the code and click Pair.
4. Click **Start sharing**. Chrome explicitly asks you to select a tab, window, or screen.
5. The app attempts WebRTC screen streaming. If the viewer doesn't confirm that video plays, it switches to slow AES-encrypted screenshots (around one image every 2.2 seconds).
6. Use Neural Band swipes up/down to zoom, swipes left/right to pan while zoomed, a pinch to toggle zoom, and pinch-and-move to pan or zoom.

## What works and what is experimental

- **Built:** pairing, explicit desktop getDisplayMedia screen capture, WebRTC track negotiation, encrypted signaling, encrypted screen-snapshot fallback, Zoom/pan gestures, and a Stop button.
- **Unverified on actual glasses:** incoming WebRTC track playback. Meta documents WebSockets and web UI, but has not documented that WebRTC video works in the Meta Web Apps runtime. See https://github.com/facebook/meta-wearables-webapp/issues/6
- **Current scope:** Screen viewing only. Gestures **do not** click arbitrary links, type, or scroll the real Chrome tab. That requires a companion browser extension or desktop app.
- **No guarantee of video:** DRM content can be blacked out, some codecs may fail, and the fallback is slow screenshots rather than smooth video.

## Security model

- Temporary pairing derives an AES-256-GCM encryption key via PBKDF2.
- The public MQTT broker `broker.emqx.io` carries application-encrypted pairing, SDP/ICE and screenshot data when needed. It can observe IP addresses, message sizes, timing, and topic identifiers.
- WebRTC media is protected by the browser's DTLS-SRTP; candidate discovery uses Google's public STUN server. A peer connection may fail on restrictive networks because this prototype has no TURN server.
- There is no dedicated private signaling backend, no permanent cloud storage of your screen, and no independent security audit.
- The user must explicitly select what Chrome shares. **Avoid showing passwords, private messages, identity documents, patient information, or confidential work**.

## Developer notes

Static HTML/CSS/JS, no build system. JavaScript syntax can be checked with `node --check shared.js && node --check computer.js && node --check glasses.js`. Chrome screen capture requires HTTPS or localhost. When publishing via GitHub Pages, enable **Settings → Pages → Build and deployment: GitHub Actions** first.

Built using the Meta Web Apps design/input guidance: https://github.com/facebook/meta-wearables-webapp .
