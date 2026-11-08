import { Character, EMOTIONS } from "./character.js";

const $ = (id) => document.getElementById(id);

const canvas = $("lab-character");
const glow = $("lab-glow");
const status = $("lab-status");
const character = new Character(canvas, {
  style: "original",
  paletteName: "mono",
  eyeTracking: true,
  blink: true,
  breathing: true,
  particles: false,
  glow: false,
  antenna: false,
});

let emotion = "happy";
let intensity = 1;
let duration = 4800;

const params = new URLSearchParams(location.search);
if (params.get("theme") && ["ink", "mint", "paper"].includes(params.get("theme"))) {
  document.documentElement.dataset.theme = params.get("theme");
}
if (params.get("style") === "original") {
  character.setStyle("original");
  $("lab-style").value = "original";
} else if (params.get("style") === "pixel") {
  character.setStyle("pixel");
  $("lab-style").value = "pixel";
}
if (params.get("palette") && ["mono", "mint", "paper"].includes(params.get("palette"))) {
  character.setPalette(params.get("palette"));
  $("lab-palette").value = params.get("palette");
}
if (params.get("emotion") && EMOTIONS[params.get("emotion")]) {
  emotion = params.get("emotion");
}
if (params.get("state") && ["idle", "listening", "thinking", "speaking", "sleeping"].includes(params.get("state"))) {
  character.setState(params.get("state"));
}

function refreshStatus() {
  const palette = document.documentElement.dataset.theme || "ink";
  status.textContent = `${EMOTIONS[emotion]?.en || emotion} · ${character.state} · ${palette}`;
}

character.onEmotion = (id, meta) => {
  glow.style.background = `radial-gradient(circle, ${meta?.color || "#7dffc4"} 0%, transparent 68%)`;
  refreshStatus();
};
character.start();

// Emotions
const grid = $("lab-emotions");
for (const [id, meta] of Object.entries(EMOTIONS)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice" + (id === emotion ? " active" : "");
  button.textContent = id;
  button.title = `${meta.en} / ${meta.ru}`;
  button.addEventListener("click", () => {
    emotion = id;
    grid.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
    character.setEmotion(id, intensity, duration, "lab");
    refreshStatus();
  });
  grid.appendChild(button);
}

if (emotion !== "neutral") {
  grid.querySelectorAll("button").forEach((node) => {
    node.classList.toggle("active", node.textContent === emotion);
  });
  character.setEmotion(emotion, intensity, duration, "lab");
}

// States
const states = $("lab-states");
states.addEventListener("click", (event) => {
  const button = event.target.closest("[data-state]");
  if (!button) return;
  states.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
  character.setState(button.dataset.state);
  refreshStatus();
});

// Style / palette
$("lab-style").addEventListener("change", (event) => {
  character.setStyle(event.target.value);
  refreshStatus();
});
$("lab-palette").addEventListener("change", (event) => {
  character.setPalette(event.target.value);
  refreshStatus();
});

// Intensity / duration
const intensityInput = $("lab-intensity");
const intensityValue = $("lab-intensity-value");
intensityInput.addEventListener("input", () => {
  intensity = Number(intensityInput.value);
  intensityValue.textContent = intensity.toFixed(2);
  character.setEmotion(emotion, intensity, duration, "lab");
});
const durationInput = $("lab-duration");
const durationValue = $("lab-duration-value");
durationInput.addEventListener("input", () => {
  duration = Number(durationInput.value);
  durationValue.textContent = duration === 0 ? "hold" : `${(duration / 1000).toFixed(1)}s`;
});

// Motion toggles
function option(id, key) {
  const input = $(id);
  input.addEventListener("change", () => {
    character.setOptions({ [key]: input.checked });
  });
}
option("lab-blink", "blink");
option("lab-breathe", "breathing");
option("lab-follow", "eyeTracking");
option("lab-particles", "particles");
option("lab-antenna", "antenna");
option("lab-reduced", "reducedMotion");

$("lab-poke").addEventListener("click", () => {
  character.poke();
  refreshStatus();
});
$("lab-wake").addEventListener("click", () => {
  character.wake();
  refreshStatus();
});

refreshStatus();
