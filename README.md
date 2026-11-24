# Crow WebAR Avatar

> Interactive Augmented Reality (WebXR) 3D crow avatar that lands on detected horizontal surfaces, flies on command, and converses via browser speech.

[Live Demo](https://richard-roman.github.io/crow-webar/)

---

## Quick Start

1. Open **[https://richard-roman.github.io/crow-webar/](https://richard-roman.github.io/crow-webar/)** in Google Chrome on an ARCore-compatible Android device.
2. Tap **Start AR** and grant camera permissions.
3. Slowly point your camera at a flat surface (table or floor). The crow will swoop in from the side and perch on the detected spot.
4. Tap anywhere on the surface to send the crow flying to that new location.
5. Tap **Tap to Speak** or **Test Voice** to interact with voice and synthetic speech.

---

## Core Capabilities

| Capability | Implementation |
|---|---|
| **WebXR Hit-Test** | Real-time plane raycasting via WebXR device API (`normal.y >= 0.85`), automatically placing the avatar on rigid horizontal surfaces. |
| **Targeted Flight & Landing** | Dynamic arc interpolation, directional banking, and timed landing sequence (`2.9s` flight phase, smooth turn-to-viewer). |
| **Voice & Speech Synthesis** | Dual-language (Spanish/English) interaction using browser-native `SpeechRecognition` and `SpeechSynthesisUtterance`. |
| **Synchronized Animations** | Isolated clips (`idle`, `talking`, `land`) dynamically triggered to open/close the beak during speech and flutter wings during flight. |
| **PBR Studio Lighting** | High dynamic range environment reflections via Three.js `RoomEnvironment` + `PMREMGenerator` for realistic feather textures and specular highlights. |
| **Zero-Build Architecture** | Plain HTML5, CSS3, and ES Modules loaded via standard `importmap` without bundlers or build steps. |

---

## Technical Stack

- **Three.js (`0.170.0`)**: 3D scene graph, `GLTFLoader`, `AnimationMixer`, `RoomEnvironment`, and WebXR manager.
- **WebXR Device API**: Native `immersive-ar` sessions with `hit-test` and `dom-overlay` features.
- **Web Speech API**: In-browser speech recognition and audio synthesis.
- **glTF 2.0 (`crow.glb`)**: Custom processed binary 3D asset with corrected transform matrices, isolated clips, and tuned scale for AR.
- **GitHub Pages**: Automated HTTPS static deployment.

---

## Local Development

WebXR and camera APIs require a secure context (HTTPS or `localhost`):

```bash
# Serve the directory locally
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser (use `localhost`, as IP addresses like `0.0.0.0` or `192.168.x.x` are treated as insecure by modern browsers).
