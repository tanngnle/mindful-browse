/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Panda Chat Controller (Blocked Page)
    Self-contained ES module for the AI chat overlay.
    Coexists with blocked.js — shares only DOM read access
    (#blocked-domain) and window.__MindfulBrowseTimer.
    ═══════════════════════════════════════════════════════ */

import {
  checkAvailability,
  createPandaSession,
  createSessionWithProgress,
} from "../lib/panda-agent.js";

// ── Constants ───────────────────────────────────────────
// Fallback messages shown when on-device AI is unavailable.
const FALLBACK_RESPONSES = [
  "Oh look, you're trying to negotiate with a panda. That's… a choice. 🐼",
  "I'd explain why you're wrong, but I don't have the internet access for that level of detail.",
  "You know what would impress me? Closing this tab. Just saying.",
  "*stares in disappointed panda* Try again when you've reconsidered your life choices.",
  "I'm literally a local AI with no internet and you still can't convince me. That's impressive.",
  "Every second you spend talking to me is a second you're not being productive. Think about that.",
  "My download was 4GB of pure disappointment and you're the one filling it up.",
  "Fun fact: the tab you're trying to visit isn't going anywhere. But your motivation might be.",
  "I'm running on a local model with zero internet access and I'm STILL more engaged than you are right now.",
  "You know what Bao thinks? Bao thinks you should close this tab. 🐼",
];

const GREETING_PROMPT = "Generate a short, passive-aggressive greeting (under 2 sentences) for someone who just got blocked from visiting {domain}. Be sarcastic and mention you're disappointed. Don't use greetings like 'Hello' — jump straight into the guilt-trip.";

const MOODS = {
  initial: "judging you...",
  mild: "mildly disappointed",
  annoyed: "deeply unimpressed",
  angry: "existentially fuming",
  nuclear: "questioning humanity",
};

// ── State ───────────────────────────────────────────────
let session = null;
let domain = "";
let isStreaming = false;
let abortController = null;
let messageCount = 0;
let fallbackIndex = 0;

// ── DOM References ──────────────────────────────────────
const chatOverlay = document.getElementById("chat-overlay");
const chatLauncher = document.getElementById("chat-launcher");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const pandaMood = document.getElementById("panda-mood");
const timerStrip = document.getElementById("timer-strip");

// Overlay open/close — the overlay is hidden by default (CSS) so the
// Pomodoro controls stay reachable. The launcher opens it; the timer
// strip closes it. No state is persisted — the chat session survives
// closing, only the overlay visibility changes.
function openOverlay() {
  if (!chatOverlay) return;
  chatOverlay.classList.add("open");
  if (chatInput) chatInput.focus();
}

function closeOverlay() {
  if (!chatOverlay) return;
  chatOverlay.classList.remove("open");
}

if (chatLauncher) chatLauncher.addEventListener("click", openOverlay);
if (timerStrip) timerStrip.addEventListener("click", closeOverlay);

// Escape closes the overlay while it's open (from any focus point inside
// it — the chat input, send button, or message log). Closed state is a
// no-op so blocked.js's Space shortcut keeps its own keydown path clear.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (chatOverlay && chatOverlay.classList.contains("open")) {
    closeOverlay();
    if (chatLauncher) chatLauncher.focus();
  }
});

// ── Init ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Read the blocked domain from the existing page element
  const domainEl = document.getElementById("blocked-domain");
  domain = domainEl?.textContent || "a distracting site";

  // Signal that chat is active (reduces particles in blocked.js)
  document.dispatchEvent(new CustomEvent("panda-chat-active"));

  // Populate the minimized timer strip
  initTimerStrip();

  // Check AI availability and initialize accordingly
  const availability = await checkAvailability();

  switch (availability) {
    case "available":
      await initAISession();
      break;
    case "downloading":
      showDownloadProgress();
      break;
    default:
      showFallbackUI();
      break;
  }

  // Wire up input events
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  chatSendBtn.addEventListener("click", handleSend);
});

// ── Timer Strip ─────────────────────────────────────────
function initTimerStrip() {
  const timerAPI = window.__MindfulBrowseTimer;
  if (!timerAPI || !timerStrip) return;

  // Build the strip content using safe DOM construction
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "timer-strip-ring");
  svg.setAttribute("viewBox", "0 0 36 36");

  const ringBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringBg.setAttribute("class", "ring-bg");
  ringBg.setAttribute("cx", "18");
  ringBg.setAttribute("cy", "18");
  ringBg.setAttribute("r", "15");

  const ringProg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringProg.setAttribute("class", "ring-progress");
  ringProg.setAttribute("cx", "18");
  ringProg.setAttribute("cy", "18");
  ringProg.setAttribute("r", "15");
  ringProg.setAttribute("stroke-dasharray", "94.25");
  ringProg.setAttribute("stroke-dashoffset", "0");
  ringProg.style.transform = "rotate(-90deg)";
  ringProg.style.transformOrigin = "center";

  svg.appendChild(ringBg);
  svg.appendChild(ringProg);
  timerStrip.appendChild(svg);

  const digits = document.createElement("span");
  digits.className = "timer-strip-digits";
  digits.textContent = timerAPI.getDisplay();
  timerStrip.appendChild(digits);

  const phase = document.createElement("span");
  phase.className = "timer-strip-phase";
  phase.textContent = formatPhase(timerAPI.getPhase());
  timerStrip.appendChild(phase);

  // Update the strip periodically
  setInterval(() => {
    if (!timerAPI) return;
    const digits = timerStrip.querySelector(".timer-strip-digits");
    const phase = timerStrip.querySelector(".timer-strip-phase");
    const progress = timerStrip.querySelector(".ring-progress");
    if (digits) digits.textContent = timerAPI.getDisplay();
    if (phase) phase.textContent = formatPhase(timerAPI.getPhase());
    if (progress) {
      const p = timerAPI.getProgress();
      const circumference = 94.25;
      progress.setAttribute("stroke-dashoffset", String(circumference * (1 - p)));
    }
  }, 1000);
}

function formatPhase(phase) {
  switch (phase) {
    case "work": return "FOCUS";
    case "shortBreak": return "BREAK";
    case "longBreak": return "LONG BREAK";
    default: return "";
  }
}

// ── AI Session Init ─────────────────────────────────────
async function initAISession() {
  showLoadingState();

  try {
    session = await createPandaSession(domain);
    clearMessages();

    // Listen for context overflow
    session.addEventListener("contextoverflow", handleContextOverflow);

    // Generate initial greeting
    const greeting = await streamResponse(
      GREETING_PROMPT.replace("{domain}", domain)
    );
    renderMessage("panda", greeting);
    updateMood("initial");
  } catch (err) {
    console.error("Failed to initialize panda session:", err);
    showFallbackUI();
  }
}

// ── Download Progress UI ────────────────────────────────
function showDownloadProgress() {
  clearMessages();
  const progressEl = document.createElement("div");
  progressEl.className = "download-progress";
  progressEl.id = "download-progress";
  const emoji = document.createElement("span");
  emoji.className = "download-progress-emoji";
  emoji.textContent = "\u{1F43C}";
  progressEl.appendChild(emoji);

  const text = document.createElement("p");
  text.className = "download-progress-text";
  const bold = document.createElement("strong");
  bold.textContent = "Bao is downloading their disappointment\u2026";
  text.appendChild(bold);
  text.appendChild(document.createElement("br"));
  text.appendChild(document.createTextNode(
    "The on-device AI model needs to be downloaded first. This only happens once."
  ));
  progressEl.appendChild(text);

  const bar = document.createElement("div");
  bar.className = "download-progress-bar";
  const fill = document.createElement("div");
  fill.className = "download-progress-fill";
  fill.id = "download-fill";
  fill.style.width = "0%";
  bar.appendChild(fill);
  progressEl.appendChild(bar);

  const pct = document.createElement("span");
  pct.className = "download-progress-percent";
  pct.id = "download-percent";
  pct.textContent = "0%";
  progressEl.appendChild(pct);
  chatMessages.appendChild(progressEl);

  // Create session with progress monitoring
  createSessionWithProgress((percent) => {
    const fill = document.getElementById("download-fill");
    const label = document.getElementById("download-percent");
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = `${percent}%`;
  })
    .then((s) => {
      session = s;
      session.addEventListener("contextoverflow", handleContextOverflow);
      clearMessages();
      // Generate greeting
      return streamResponse(GREETING_PROMPT.replace("{domain}", domain));
    })
    .then((greeting) => {
      renderMessage("panda", greeting);
      updateMood("initial");
    })
    .catch((err) => {
      console.error("Download/session failed:", err);
      showFallbackUI();
    });
}

// ── Fallback UI (no AI available) ───────────────────────
function showFallbackUI() {
  clearMessages();
  const fallback = document.createElement("div");
  fallback.className = "fallback-notice";
  const emoji = document.createElement("span");
  emoji.className = "fallback-notice-emoji";
  emoji.textContent = "\u{1F43C}";
  fallback.appendChild(emoji);

  const text = document.createElement("p");
  text.className = "fallback-notice-text";
  const bold = document.createElement("strong");
  bold.textContent = "Bao is on a bamboo break.";
  text.appendChild(bold);
  text.appendChild(document.createElement("br"));
  text.appendChild(document.createTextNode(
    "On-device AI isn\u2019t available on this device. Bao still judges you \u2014 just with pre-written snark."
  ));
  text.appendChild(document.createElement("br"));
  text.appendChild(document.createElement("br"));
  const em = document.createElement("em");
  em.textContent = "Requires Chrome 138+ with 22GB free storage and a capable GPU or CPU.";
  text.appendChild(em);
  fallback.appendChild(text);
  chatMessages.appendChild(fallback);

  // Show a static snarky message after a brief pause
  setTimeout(() => {
    renderMessage("panda", `So you tried to visit ${domain}. Bold move. I'd be more surprised if your track record didn't speak for itself. 🐼`);
    updateMood("mild");
  }, 800);
}

// ── Loading State ───────────────────────────────────────
function showLoadingState() {
  clearMessages();
  const loading = document.createElement("div");
  loading.className = "chat-loading";
  loading.id = "chat-loading";
  const emoji = document.createElement("span");
  emoji.className = "chat-loading-emoji";
  emoji.textContent = "\u{1F43C}";
  loading.appendChild(emoji);

  const text = document.createElement("span");
  text.className = "chat-loading-text";
  text.textContent = "Bao is waking up\u2026";
  loading.appendChild(text);
  chatMessages.appendChild(loading);
}

// ── Chat Logic ──────────────────────────────────────────
async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  // Render user message
  renderMessage("user", text);
  chatInput.value = "";
  messageCount++;

  // Update mood based on conversation length
  updateMoodByCount();

  if (session) {
    // AI-powered response
    await handleAIResponse(text);
  } else {
    // Fallback response
    handleFallbackResponse();
  }
}

async function handleAIResponse(userText) {
  isStreaming = true;
  setInputEnabled(false);
  showTypingIndicator();

  try {
    abortController = new AbortController();
    const response = await streamResponse(userText, abortController.signal);
    removeTypingIndicator();
    renderMessage("panda", response);
  } catch (err) {
    removeTypingIndicator();
    if (err.name === "AbortError") {
      renderMessage("panda", "*glares at you in silence* You stopped me mid-guilt-trip. Impressive. 🐼");
    } else {
      console.error("Panda response failed:", err);
      renderMessage("panda", "Bao lost their train of thought. Try again — if you dare.");
    }
  } finally {
    isStreaming = false;
    abortController = null;
    setInputEnabled(true);
    chatInput.focus();
  }
}

function handleFallbackResponse() {
  isStreaming = true;
  setInputEnabled(false);
  showTypingIndicator();

  // Simulate thinking delay for fallback
  setTimeout(() => {
    removeTypingIndicator();
    const response = FALLBACK_RESPONSES[fallbackIndex % FALLBACK_RESPONSES.length];
    fallbackIndex++;
    renderMessage("panda", response);
    isStreaming = false;
    setInputEnabled(true);
    chatInput.focus();
  }, 800 + Math.random() * 1200);
}

// ── Streaming ───────────────────────────────────────────
async function streamResponse(userText, signal) {
  if (!session) throw new Error("No session available");

  const stream = session.promptStreaming(userText, signal ? { signal } : undefined);
  let fullResponse = "";

  // Create the panda bubble early for streaming into it
  const { bubble } = renderMessage("panda", "");
  const cursor = document.createElement("span");
  cursor.className = "streaming-cursor";
  bubble.appendChild(cursor);

  for await (const chunk of stream) {
    fullResponse += chunk;
    // Update bubble text, keeping the cursor at the end
    bubble.textContent = fullResponse;
    bubble.appendChild(cursor);
    scrollToBottom();
  }

  // Remove the streaming cursor
  cursor.remove();
  return fullResponse;
}

// ── Message Rendering ───────────────────────────────────
function renderMessage(role, content) {
  const row = document.createElement("div");
  row.className = `msg-row msg-row--${role}`;

  if (role === "panda") {
    const avatar = document.createElement("span");
    avatar.className = "msg-avatar";
    avatar.textContent = "🐼";
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = `msg-bubble msg-bubble--${role}`;
  bubble.textContent = content;
  row.appendChild(bubble);

  chatMessages.appendChild(row);
  scrollToBottom();

  return { row, bubble };
}

function showTypingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.id = "typing-indicator";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "typing-dot";
    indicator.appendChild(dot);
  }

  const row = document.createElement("div");
  row.className = "msg-row msg-row--panda";
  row.id = "typing-row";

  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.textContent = "🐼";

  row.appendChild(avatar);
  row.appendChild(indicator);
  chatMessages.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  const row = document.getElementById("typing-row");
  if (indicator) indicator.remove();
  if (row) row.remove();
}

// ── Context Window Management ───────────────────────────
function handleContextOverflow() {
  // When context overflows, the session drops old messages automatically.
  // We just add a visual indicator and update mood.
  const indicator = document.createElement("div");
  indicator.className = "context-indicator";
  indicator.textContent = "— Bao forgot the beginning of this conversation (but not your mistakes) —";
  chatMessages.appendChild(indicator);
  scrollToBottom();
  updateMood("nuclear");
}

// ── Mood Management ─────────────────────────────────────
function updateMood(mood) {
  if (pandaMood) {
    pandaMood.textContent = MOODS[mood] || MOODS.initial;
  }
}

function updateMoodByCount() {
  if (messageCount <= 2) updateMood("initial");
  else if (messageCount <= 5) updateMood("mild");
  else if (messageCount <= 10) updateMood("annoyed");
  else if (messageCount <= 15) updateMood("angry");
  else updateMood("nuclear");
}

// ── Helpers ─────────────────────────────────────────────
function setInputEnabled(enabled) {
  chatInput.disabled = !enabled;
  chatSendBtn.disabled = !enabled;
}

function clearMessages() {
  if (chatMessages) chatMessages.innerHTML = "";
}

function scrollToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}
