import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('xr-canvas');
const cameraBg = document.getElementById('camera-bg');
const uiOverlay = document.getElementById('ui-overlay');
const statusPill = document.getElementById('status-pill');
const langSelect = document.getElementById('lang-select');
const arBtn = document.getElementById('ar-btn');
const camBtn = document.getElementById('cam-btn');
const landBtn = document.getElementById('land-btn');
const arHint = document.getElementById('ar-hint');
const talkBtn = document.getElementById('talk-btn');
const testVoiceBtn = document.getElementById('test-voice-btn');
const transcriptEl = document.getElementById('transcript');
const textForm = document.getElementById('text-form');
const textInput = document.getElementById('text-input');

const LAND_START_TIME_SEC = 0;
const HORIZONTAL_NORMAL_MIN_Y = 0.85;
const AUTO_PLACE_FRAMES = 6;

const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let renderer;
let scene;
let camera;
let controls;
let crowAnchor;
let reticle;

let mixer = null;
const actions = {};
let activeAction = null;
let isLanding = false;

let xrSession = null;
let hitTestSource = null;
let hitTestRequested = false;
let hasPlacedInAR = false;
let horizontalHitStreak = 0;

let mediaStream = null;
let recognition = null;
let isListening = false;

const clock = new THREE.Clock();
const hitMatrix = new THREE.Matrix4();
const hitPos = new THREE.Vector3();
const camWorldPos = new THREE.Vector3();

initLanguage();
initScene();
loadCrowModel();
setupARSupport();
setupControls();
tryAutoStartCamera();
renderer.setAnimationLoop(renderFrame);

function initLanguage() {
  const prefersSpanish = (navigator.language || '').toLowerCase().startsWith('es');
  langSelect.value = prefersSpanish ? 'es-ES' : 'en-US';
}

function setStatus(text) {
  statusPill.textContent = text;
}

function showTranscript(text) {
  transcriptEl.hidden = !text;
  transcriptEl.textContent = text;
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmremGenerator.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 1.25;
  envScene.dispose();
  pmremGenerator.dispose();

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.05,
    50
  );
  camera.position.set(0, 0.42, 1.3);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0.24, 0);
  controls.update();

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x64748b, 1.5);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(1.5, 3.0, 2.0);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xe2e8f0, 0.9);
  rimLight.position.set(-1.5, 2.0, -2.0);
  scene.add(rimLight);

  crowAnchor = new THREE.Group();
  scene.add(crowAnchor);

  const reticleGeo = new THREE.RingGeometry(0.1, 0.13, 32).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    side: THREE.DoubleSide,
  });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function loadCrowModel() {
  const loader = new GLTFLoader();
  loader.load(
    './crow.glb',
    (gltf) => {
      crowAnchor.add(gltf.scene);

      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        actions[clip.name] = mixer.clipAction(clip);
      }

      mixer.addEventListener('finished', (event) => {
        if (event.action === actions.land) {
          isLanding = false;
          fadeToAction('idle', 0.35);
          setStatus(xrSession ? 'AR perched: tap to speak' : 'Ready');
        }
      });

      fadeToAction('idle', 0);
      landBtn.disabled = false;
      testVoiceBtn.disabled = false;

      if (SpeechRecognitionCtor) {
        talkBtn.disabled = false;
        talkBtn.textContent = 'Tap to Speak';
      } else {
        talkBtn.disabled = true;
        talkBtn.textContent = 'Mic Unsupported (Use Text)';
      }

      setStatus(
        window.isSecureContext
          ? 'Ready'
          : 'Ready (HTTPS required for WebXR AR & mic)'
      );
    },
    undefined,
    (err) => {
      console.error('Failed to load crow.glb:', err);
      setStatus('Failed to load crow.glb');
    }
  );
}

function fadeToAction(name, duration = 0.25) {
  const next = actions[name];
  if (!next || next === activeAction) return;

  next.reset();
  next.setLoop(THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = false;
  next.enabled = true;
  next.play();

  if (activeAction) {
    activeAction.crossFadeTo(next, duration, true);
  }
  activeAction = next;
}

function playLandingSequence() {
  const land = actions.land;
  if (!land) {
    fadeToAction('idle', 0.2);
    return;
  }

  isLanding = true;
  land.reset();
  land.setLoop(THREE.LoopOnce, 1);
  land.clampWhenFinished = true;
  land.time = LAND_START_TIME_SEC;
  land.enabled = true;
  land.play();

  if (activeAction && activeAction !== land) {
    activeAction.crossFadeTo(land, 0.2, false);
  }
  activeAction = land;
  setStatus('Crow flying in...');
}

async function setupARSupport() {
  if (!('xr' in navigator)) {
    arBtn.textContent = 'AR Unsupported';
    arBtn.disabled = true;
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (supported) {
      arBtn.disabled = false;
      arBtn.textContent = 'Start AR';
    } else {
      arBtn.disabled = true;
      arBtn.textContent = 'AR Unsupported';
    }
  } catch {
    arBtn.disabled = true;
    arBtn.textContent = 'AR Unavailable';
  }
}

async function tryAutoStartCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    camBtn.textContent = 'Camera Needs HTTPS';
    camBtn.disabled = true;
    return;
  }
  await startPreviewCamera(true);
}

async function startPreviewCamera(silent = false) {
  if (mediaStream || xrSession) return;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    cameraBg.srcObject = mediaStream;
    cameraBg.classList.add('is-active');
    camBtn.textContent = 'Camera Off';
  } catch (err) {
    mediaStream = null;
    cameraBg.classList.remove('is-active');
    camBtn.textContent = 'Camera On';
    if (!silent) {
      setStatus(`Camera error: ${err.name || err.message}`);
    }
  }
}

function stopPreviewCamera() {
  if (!mediaStream) return;
  for (const track of mediaStream.getTracks()) {
    track.stop();
  }
  mediaStream = null;
  cameraBg.srcObject = null;
  cameraBg.classList.remove('is-active');
  camBtn.textContent = 'Camera On';
}

async function toggleARSession() {
  if (xrSession) {
    await xrSession.end();
    return;
  }

  if (!navigator.xr) return;

  // Release getUserMedia camera before WebXR claims the hardware camera.
  stopPreviewCamera();

  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: uiOverlay },
    });

    xrSession = session;
    hitTestRequested = false;
    hitTestSource = null;
    resetARPlacement();

    session.addEventListener('end', onXRSessionEnd);

    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', onXRSelect);

    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);

    controls.enabled = false;
    camBtn.hidden = true;
    arBtn.textContent = 'Exit AR';
    landBtn.textContent = 'Rescan Surface';
    setStatus('Scanning for floor or table...');
  } catch (err) {
    setStatus(`Could not start AR: ${err.message}`);
  }
}

function resetARPlacement() {
  hasPlacedInAR = false;
  horizontalHitStreak = 0;
  crowAnchor.visible = false;
  reticle.visible = false;
  arHint.hidden = false;
}

function onXRSelect() {
  if (!xrSession || hasPlacedInAR || !reticle.visible) return;
  hitMatrix.copy(reticle.matrix);
  placeCrowAtMatrix(hitMatrix);
}

function onXRSessionEnd() {
  xrSession = null;
  hitTestSource = null;
  hitTestRequested = false;
  hasPlacedInAR = false;
  horizontalHitStreak = 0;

  reticle.visible = false;
  arHint.hidden = true;

  crowAnchor.visible = true;
  crowAnchor.position.set(0, 0, 0);
  crowAnchor.rotation.set(0, 0, 0);
  controls.enabled = true;

  camBtn.hidden = false;
  arBtn.textContent = 'Start AR';
  landBtn.textContent = 'Fly & Land';
  setStatus('3D preview ready');
  startPreviewCamera(true);
}

function placeCrowAtMatrix(matrix) {
  hitPos.setFromMatrixPosition(matrix);
  crowAnchor.position.copy(hitPos);

  const xrCamera = renderer.xr.getCamera();
  xrCamera.getWorldPosition(camWorldPos);
  const yaw = Math.atan2(camWorldPos.x - hitPos.x, camWorldPos.z - hitPos.z);
  crowAnchor.rotation.set(0, yaw, 0);

  crowAnchor.visible = true;
  reticle.visible = false;
  hasPlacedInAR = true;
  arHint.hidden = true;

  playLandingSequence();
}

function processHitTest(frame) {
  if (!xrSession || hasPlacedInAR) return;

  if (!hitTestRequested) {
    hitTestRequested = true;
    xrSession
      .requestReferenceSpace('viewer')
      .then((viewerSpace) => xrSession.requestHitTestSource({ space: viewerSpace }))
      .then((source) => {
        hitTestSource = source;
      })
      .catch(() => {
        setStatus('Hit-test unavailable on this device');
      });
    return;
  }

  if (!hitTestSource) return;

  const refSpace = renderer.xr.getReferenceSpace();
  const results = frame.getHitTestResults(hitTestSource);
  if (results.length === 0) {
    horizontalHitStreak = 0;
    reticle.visible = false;
    return;
  }

  const pose = results[0].getPose(refSpace);
  if (!pose) {
    horizontalHitStreak = 0;
    reticle.visible = false;
    return;
  }

  hitMatrix.fromArray(pose.transform.matrix);
  // Column 1 (elements 4..6) is the surface normal; Y >= 0.85 filters out walls.
  const isHorizontal = hitMatrix.elements[5] >= HORIZONTAL_NORMAL_MIN_Y;
  if (!isHorizontal) {
    horizontalHitStreak = 0;
    reticle.visible = false;
    return;
  }

  reticle.visible = true;
  reticle.matrix.copy(hitMatrix);
  horizontalHitStreak += 1;

  if (horizontalHitStreak >= AUTO_PLACE_FRAMES) {
    placeCrowAtMatrix(hitMatrix);
  }
}

function renderFrame(_timestamp, frame) {
  const delta = clock.getDelta();
  if (mixer) {
    mixer.update(delta);
  }

  if (xrSession && frame) {
    processHitTest(frame);
  } else if (controls.enabled) {
    controls.update();
  }

  renderer.render(scene, camera);
}

function buildReply(userText, lang) {
  const clean = userText.trim().toLowerCase();
  const isEs = lang.startsWith('es');

  if (!clean) {
    return isEs
      ? '¡Hola! Soy tu cuervo en realidad aumentada.'
      : 'Hello! I am your augmented reality crow.';
  }

  if (/(hola|buenas|hey|hello|hi)\b/.test(clean)) {
    return isEs
      ? '¡Hola! Ya aterricé en tu espacio y estoy listo para charlar.'
      : 'Hello! I just landed in your space and I am ready to chat.';
  }

  if (/(quien eres|quién eres|nombre|who are you|your name)/.test(clean)) {
    return isEs
      ? 'Soy un cuervo 3D corriendo con Three.js, WebXR y voz del navegador.'
      : 'I am a 3D crow running with Three.js, WebXR, and browser speech.';
  }

  if (/(hora|time)/.test(clean)) {
    const now = new Date().toLocaleTimeString(lang, {
      hour: '2-digit',
      minute: '2-digit',
    });
    return isEs ? `Son las ${now}.` : `It is currently ${now}.`;
  }

  return isEs ? `Escuché: ${userText}` : `I heard you say: ${userText}`;
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    showTranscript(text);
    setStatus('Speech synthesis unsupported');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langSelect.value;
  utterance.rate = 1.0;
  utterance.pitch = 1.05;

  const restoreIdle = () => {
    if (!isLanding) {
      fadeToAction('idle', 0.25);
    }
    talkBtn.classList.remove('is-speaking');
    setStatus(xrSession ? 'AR active' : 'Ready');
  };

  utterance.onstart = () => {
    isLanding = false;
    fadeToAction('talking', 0.15);
    talkBtn.classList.add('is-speaking');
    setStatus('Speaking...');
    showTranscript(`Crow: "${text}"`);
  };

  utterance.onend = restoreIdle;
  utterance.onerror = restoreIdle;

  window.speechSynthesis.speak(utterance);
}

function startListening() {
  if (!SpeechRecognitionCtor || isListening) return;

  recognition = new SpeechRecognitionCtor();
  recognition.lang = langSelect.value;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    talkBtn.classList.add('is-listening');
    talkBtn.textContent = 'Listening...';
    setStatus('Listening...');
  };

  recognition.onresult = (event) => {
    const heard = event.results?.[0]?.[0]?.transcript || '';
    showTranscript(`You: "${heard}"`);
    speak(buildReply(heard, langSelect.value));
  };

  recognition.onerror = (event) => {
    setStatus(`Mic error: ${event.error}`);
  };

  recognition.onend = () => {
    isListening = false;
    talkBtn.classList.remove('is-listening');
    talkBtn.textContent = 'Tap to Speak';
  };

  try {
    recognition.start();
  } catch (err) {
    isListening = false;
    setStatus(`Could not start mic: ${err.message}`);
  }
}

function setupControls() {
  uiOverlay.addEventListener('beforexrselect', (event) => {
    event.preventDefault();
  });

  arBtn.addEventListener('click', toggleARSession);

  camBtn.addEventListener('click', () => {
    if (mediaStream) {
      stopPreviewCamera();
    } else {
      startPreviewCamera(false);
    }
  });

  landBtn.addEventListener('click', () => {
    if (xrSession) {
      resetARPlacement();
      setStatus('Scanning for floor or table...');
    } else {
      playLandingSequence();
    }
  });

  talkBtn.addEventListener('click', () => {
    if (isListening && recognition) {
      recognition.stop();
      return;
    }
    startListening();
  });

  testVoiceBtn.addEventListener('click', () => {
    speak(buildReply('', langSelect.value));
  });

  textForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = textInput.value.trim();
    if (!message) return;
    textInput.value = '';
    showTranscript(`You: "${message}"`);
    speak(buildReply(message, langSelect.value));
  });
}
