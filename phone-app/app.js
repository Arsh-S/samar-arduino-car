// Samar Car - phone controller
// Loads COCO-SSD, runs detection on rear camera, sends drive commands
// over Web Bluetooth to an Arduino UNO R4 WiFi BLE peripheral.

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const CMD_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// COCO-SSD class list (all 80 supported classes).
const COCO_CLASSES = [
  "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
  "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
  "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
  "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
  "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
  "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
  "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
  "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
  "remote","keyboard","cell phone","microwave","oven","toaster","sink",
  "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
  "toothbrush"
];

const els = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  bleStatus: document.getElementById("bleStatus"),
  modelStatus: document.getElementById("modelStatus"),
  fps: document.getElementById("fps"),
  targetClass: document.getElementById("targetClass"),
  minConf: document.getElementById("minConf"),
  minConfVal: document.getElementById("minConfVal"),
  connectBtn: document.getElementById("connectBtn"),
  autoBtn: document.getElementById("autoBtn"),
  cmd: document.getElementById("cmd"),
};

const state = {
  model: null,
  bleDevice: null,
  cmdChar: null,
  autopilot: false,
  lastSentCmd: null,
  lastSentAt: 0,
  fpsTimes: [],
};

// --- UI setup ---

function populateClasses() {
  for (const c of COCO_CLASSES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === "person") opt.selected = true;
    els.targetClass.appendChild(opt);
  }
}

els.minConf.addEventListener("input", () => {
  els.minConfVal.textContent = parseFloat(els.minConf.value).toFixed(2);
});

els.connectBtn.addEventListener("click", connectBle);
els.autoBtn.addEventListener("click", () => {
  if (!state.cmdChar) return;
  state.autopilot = !state.autopilot;
  els.autoBtn.textContent = `Autopilot: ${state.autopilot ? "ON" : "OFF"}`;
  els.autoBtn.classList.toggle("on", state.autopilot);
  if (!state.autopilot) sendCmd("S", true);
});

// --- Camera ---

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width:  { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
  els.video.srcObject = stream;
  await new Promise((res) => {
    if (els.video.readyState >= 2) return res();
    els.video.onloadedmetadata = () => res();
  });
  await els.video.play();
  resizeOverlay();
  window.addEventListener("resize", resizeOverlay);
}

function resizeOverlay() {
  els.overlay.width = els.video.videoWidth || els.video.clientWidth;
  els.overlay.height = els.video.videoHeight || els.video.clientHeight;
}

// --- Model ---

async function loadModel() {
  els.modelStatus.textContent = "Model: loading";
  els.modelStatus.classList.remove("good"); els.modelStatus.classList.add("bad");
  state.model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  els.modelStatus.textContent = "Model: ready";
  els.modelStatus.classList.remove("bad"); els.modelStatus.classList.add("good");
}

// --- BLE ---

async function connectBle() {
  if (!("bluetooth" in navigator)) {
    alert("Web Bluetooth not available. Use Chrome on Android.");
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener("gattserverdisconnected", onBleDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const ch = await service.getCharacteristic(CMD_CHAR_UUID);

    state.bleDevice = device;
    state.cmdChar = ch;
    els.bleStatus.textContent = `BLE: ${device.name || "connected"}`;
    els.bleStatus.classList.remove("bad"); els.bleStatus.classList.add("good");
    els.autoBtn.disabled = false;
  } catch (err) {
    console.warn("BLE connect failed", err);
    alert("BLE connect failed: " + err.message);
  }
}

function onBleDisconnected() {
  state.cmdChar = null;
  state.autopilot = false;
  els.bleStatus.textContent = "BLE: disconnected";
  els.bleStatus.classList.remove("good"); els.bleStatus.classList.add("bad");
  els.autoBtn.disabled = true;
  els.autoBtn.textContent = "Autopilot: OFF";
  els.autoBtn.classList.remove("on");
}

async function sendCmd(c, force = false) {
  els.cmd.textContent = c;
  if (!state.cmdChar) return;
  const now = performance.now();
  // Throttle: resend same command at most every 200ms; new command immediately.
  if (!force && c === state.lastSentCmd && now - state.lastSentAt < 200) return;
  state.lastSentCmd = c;
  state.lastSentAt = now;
  try {
    const buf = new Uint8Array([c.charCodeAt(0)]);
    if (state.cmdChar.writeValueWithoutResponse) {
      await state.cmdChar.writeValueWithoutResponse(buf);
    } else {
      await state.cmdChar.writeValue(buf);
    }
  } catch (err) {
    console.warn("BLE write failed", err);
  }
}

// --- Steering policy ---

// Given the target box and frame width, decide F/L/R/S.
// Box: {bbox: [x, y, w, h], score, class}
function decide(box, frameW) {
  if (!box) return "S";
  const [x, , w] = box.bbox;
  const cx = x + w / 2;
  const norm = (cx - frameW / 2) / (frameW / 2); // -1 left .. +1 right
  const deadband = 0.15;
  if (norm < -deadband) return "L";
  if (norm > deadband) return "R";
  return "F";
}

// --- Detection loop ---

async function loop() {
  const ctx = els.overlay.getContext("2d");
  const target = () => els.targetClass.value;
  const minConf = () => parseFloat(els.minConf.value);

  const tick = async () => {
    if (state.model && els.video.readyState >= 2) {
      const preds = await state.model.detect(els.video, 10, 0.2);
      const wantClass = target();
      const wantConf = minConf();
      const candidates = preds.filter(
        (p) => p.class === wantClass && p.score >= wantConf,
      );
      // Pick largest box.
      candidates.sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]);
      const best = candidates[0];

      draw(ctx, preds, best, wantClass);

      const cmd = state.autopilot ? decide(best, els.overlay.width) : "S";
      sendCmd(cmd);

      // FPS
      const now = performance.now();
      state.fpsTimes.push(now);
      while (state.fpsTimes.length && now - state.fpsTimes[0] > 1000) {
        state.fpsTimes.shift();
      }
      els.fps.textContent = `${state.fpsTimes.length} fps`;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function draw(ctx, preds, best, wantClass) {
  const W = els.overlay.width, H = els.overlay.height;
  ctx.clearRect(0, 0, W, H);

  // Center crosshair + deadband markers.
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(W / 2 - W * 0.15, 0); ctx.lineTo(W / 2 - W * 0.15, H);
  ctx.moveTo(W / 2 + W * 0.15, 0); ctx.lineTo(W / 2 + W * 0.15, H);
  ctx.stroke();

  for (const p of preds) {
    const [x, y, w, h] = p.bbox;
    const isTarget = p === best;
    ctx.lineWidth = isTarget ? 4 : 2;
    ctx.strokeStyle = isTarget ? "#28c864" : (p.class === wantClass ? "#f0c040" : "rgba(255,255,255,0.5)");
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = "16px sans-serif";
    ctx.fillText(`${p.class} ${(p.score * 100).toFixed(0)}%`, x + 4, y + 18);
  }
}

// --- Boot ---

(async function main() {
  populateClasses();
  try {
    await startCamera();
  } catch (err) {
    alert("Camera failed: " + err.message);
    return;
  }
  await loadModel();
  loop();
})();
