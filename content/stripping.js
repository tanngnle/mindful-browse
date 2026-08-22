/*  ══════════════════════════════════════════════════════
    MindfulBrowse — Content Script (Stripping)
    Injected declaratively on YouTube and Facebook pages.
    Controls stripping by setting html[data-fg-*] attributes
    that gate CSS rules in content/stripping.css.

    This mirrors the Unhook extension approach:
    - CSS is declared in the manifest and injected
      synchronously by the browser at document_start.
    - The content script reads the user's profile from
      storage and sets/removes html attributes to toggle
      individual element visibility.
    - No dynamic <style> injection — the browser handles
      CSS delivery, eliminating timing races.
    - Self-contained: no ES module imports, works regardless
      of how Chrome loads the script.
    ═══════════════════════════════════════════════════════ */

// ── Platform Element Definitions ────────────────────────
// Maps platform domains to their strippable element names.
// Inlined here to avoid ES module imports.

const PLATFORM_ELEMENTS = {
  "youtube.com": ["homeFeed", "sidebar", "shorts", "comments", "trending", "endScreen"],
  "facebook.com": ["sidebar", "newsFeed", "rightSidebar", "stories", "reels", "watch", "marketplace"],
};

function getAvailableElements(hostname) {
  const clean = hostname.replace(/^www\./, "").toLowerCase();
  for (const [domain, elements] of Object.entries(PLATFORM_ELEMENTS)) {
    if (clean === domain || clean.endsWith("." + domain)) {
      return elements;
    }
  }
  return null;
}

// ── Interstitial Overlay ────────────────────────────────
// Full-screen overlay that appears before the page loads.
// Shows a breathing animation + countdown timer.
// What happens when the countdown reaches 0 depends on the level:
//   strip    → the overlay fades out and removes itself automatically
//              ("3s breathing + hide distractions" — no click needed);
//   friction → the "I still want to go" button ENABLES at 0:00 and
//              remains the ONLY exit — the user must consciously
//              confirm their intention ("15s delay + intention").
// This implements the "mindful delay" flow from the product spec.

const OVERLAY_STYLES = `
  #mindfulbrowse-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-dark, #08080f);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: var(--font-body, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif);
    color: var(--text-primary, #e8e8f0);
    transition: opacity 0.5s ease;
  }
  #mindfulbrowse-overlay.fade-out {
    opacity: 0;
  }
  #mindfulbrowse-overlay .breathing-ring {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 3px solid var(--work-color, #2ed573);
    opacity: 0.4;
    animation: mindfulbrowse-breathe 4s ease-in-out infinite;
    margin-bottom: 32px;
  }
  @keyframes mindfulbrowse-breathe {
    0%, 100% { transform: scale(0.9); opacity: 0.3; }
    50% { transform: scale(1.15); opacity: 0.6; }
  }
  #mindfulbrowse-overlay .message {
    text-align: center;
    margin-bottom: 24px;
  }
  #mindfulbrowse-overlay .message h1 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  #mindfulbrowse-overlay .message p {
    font-size: 13px;
    color: var(--text-secondary, #8888aa);
  }
  #mindfulbrowse-overlay .message .domain {
    color: var(--work-color, #2ed573);
    font-weight: 600;
  }
  #mindfulbrowse-overlay .countdown {
    font-family: var(--font-display, 'Orbitron', monospace);
    font-size: 36px;
    letter-spacing: 2px;
    margin-bottom: 24px;
  }
  #mindfulbrowse-overlay .btn-proceed {
    padding: 12px 32px;
    border: none;
    border-radius: 12px;
    font-family: var(--font-body, 'Inter', sans-serif);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #mindfulbrowse-overlay .btn-proceed:disabled {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-muted, #555570);
    cursor: not-allowed;
  }
  #mindfulbrowse-overlay .btn-proceed:not(:disabled) {
    background: var(--work-color, #2ed573);
    color: var(--bg-dark, #08080f);
  }
  #mindfulbrowse-overlay .btn-proceed:not(:disabled):hover {
    background: #3ee883;
    transform: scale(1.02);
  }
`;

// ── Overlay Delay Decision ──────────────────────────────
// Pure helper: how long the interstitial overlay should last
// for a given site.
//   strip   → fixed 3s
//   friction→ site.frictionDelay, falling back to 15s
//   block   → null (no overlay; background already redirected)
// Exposed on `self` so tests can exercise the decision directly
// (content scripts are self-contained — no ES imports).

function getInterstitialDelaySeconds(site) {
  const restrictionLevel = site?.restrictionLevel || "strip";
  if (restrictionLevel === "block") return null;
  if (restrictionLevel === "friction") {
    // Clamp corrupt data (negative / NaN / non-numeric) — a bogus delay
    // would otherwise render a broken countdown or strand the overlay.
    const d = site.frictionDelay;
    return Number.isFinite(d) && d > 0 ? Math.ceil(d) : 15;
  }
  return 3;
}

self.__mindfulBrowseStrippingInternals = { getInterstitialDelaySeconds };

function createInterstitialOverlay(delaySeconds, targetDomain, autoProceed = false) {
  // autoProceed (Strip level): at 0:00 the overlay dismisses itself via
  // the same fade-out path the button uses. Friction passes false — the
  // button enabling at 0:00 stays the only exit.
  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.id = 'mindfulbrowse-overlay-styles';
  styleEl.textContent = OVERLAY_STYLES;
  document.head.appendChild(styleEl);

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'mindfulbrowse-overlay';
  overlay.innerHTML = `
    <div class="breathing-ring"></div>
    <div class="message">
      <h1>Take a deep breath</h1>
      <p>You're about to visit <span class="domain">${targetDomain}</span></p>
    </div>
    <div class="countdown">0:${delaySeconds.toString().padStart(2, '0')}</div>
    <button class="btn-proceed" disabled>I still want to go</button>
  `;

  document.documentElement.appendChild(overlay);

  // Countdown logic
  let remaining = delaySeconds;
  const countdownEl = overlay.querySelector('.countdown');
  const btnProceed = overlay.querySelector('.btn-proceed');

  // Shared exit path — fade out, then remove overlay + injected styles.
  // Used by the proceed button AND by Strip's auto-dismiss at 0:00.
  function dismissOverlay() {
    stopOverlayCountdown();
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      styleEl.remove();
    }, 500);
  }

  stopOverlayCountdown();
  overlayCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      stopOverlayCountdown();
      countdownEl.textContent = '0:00';
      countdownEl.style.color = 'var(--work-color, #2ed573)';
      if (autoProceed) {
        // Strip: continue automatically — no click required.
        dismissOverlay();
      } else {
        // Friction: button enables but the user must click to proceed.
        btnProceed.disabled = false;
      }
    } else {
      countdownEl.textContent = `0:${remaining.toString().padStart(2, '0')}`;
    }
  }, 1000);

  // Proceed button (Friction's only exit; Strip dismisses before it
  // can ever be enabled, but the handler stays for robustness).
  btnProceed.addEventListener('click', dismissOverlay);
}

// ── Overlay once-per-URL guard ──────────────────────────
// applyStrippingProfile() re-runs on every sync onChanged event and
// on every YouTube SPA navigation (`yt-page-data-updated`). The overlay
// must NOT reappear for the same page — track the URL it last showed
// for. Same URL → skip. Changed URL (real SPA navigation) → re-apply
// the overlay with the correct delay for the site's restriction level.
let lastOverlayUrl = null;

// Module-scoped handle to the live overlay's countdown interval. Hoisted
// out of createInterstitialOverlay so removeExistingOverlay() can cancel
// it when a live overlay is torn down (master/site toggle off, level
// flipped to block, SPA re-navigation) instead of leaking it until it
// counts itself to zero.
let overlayCountdownInterval = null;

function stopOverlayCountdown() {
  if (overlayCountdownInterval != null) {
    clearInterval(overlayCountdownInterval);
    overlayCountdownInterval = null;
  }
}

function showInterstitialIfNeeded(site) {
  // Block is handled by the background redirect — no overlay.
  const delaySeconds = getInterstitialDelaySeconds(site);
  if (delaySeconds === null) return;

  const currentUrl = window.location.href;
  if (lastOverlayUrl === currentUrl) return;

  // SPA navigation: tear down any overlay/style leftovers from the
  // previous page and cancel the old countdown interval before building
  // a fresh one — overlays must never stack across navigations.
  removeExistingOverlay();
  lastOverlayUrl = currentUrl;
  // Strip auto-continues when its 3s countdown ends; Friction needs an
  // explicit click, so only Strip gets the auto-proceed flag.
  const restrictionLevel = site?.restrictionLevel || "strip";
  createInterstitialOverlay(
    delaySeconds,
    window.location.hostname,
    restrictionLevel === "strip"
  );
}

function removeExistingOverlay() {
  // Drop visible overlays (and their styles) when protection is
  // switched off for this page — master toggle, site toggle, or a flip
  // to Block. Iterates EVERY instance so stacked duplicates from past
  // SPA navigations all die, not just the first one getElementById sees.
  lastOverlayUrl = null;
  stopOverlayCountdown();
  document
    .querySelectorAll("#mindfulbrowse-overlay, #mindfulbrowse-overlay-styles")
    .forEach((el) => el.remove());
}

// ── Attribute Helpers ───────────────────────────────────
// The CSS file uses html[data-fg-{element}="true"] gates.
// Setting an attribute instantly activates the corresponding
// CSS rule; removing it deactivates the rule. No style
// element creation/removal needed.

const html = document.documentElement;

function setStripAttribute(elementName, enabled) {
  // Convert camelCase to kebab-case: homeFeed → home-feed
  const kebab = elementName.replace(/([A-Z])/g, '-$1').toLowerCase();
  const attr = `data-fg-${kebab}`;
  if (enabled) {
    html.setAttribute(attr, "true");
  } else {
    html.removeAttribute(attr);
  }
}

function clearAllStripAttributes() {
  // Remove any data-fg-* attributes we may have set
  const attrs = Array.from(html.attributes).filter((a) =>
    a.name.startsWith("data-fg-")
  );
  attrs.forEach((a) => html.removeAttribute(a.name));
}

// ── Apply Stripping Profile ─────────────────────────────
// Reads the stripping profile from storage and sets the
// appropriate html attributes. The CSS file (injected
// synchronously by the browser) handles the actual hiding.

async function applyStrippingProfile() {
  const hostname = window.location.hostname;

  try {
    const data = await chrome.storage.sync.get(["sites", "enabled"]);
    const sites = data.sites || [];

    // Master toggle off — strip nothing, no overlay
    if (data.enabled === false) {
      clearAllStripAttributes();
      removeExistingOverlay();
      return;
    }

    // Find the site entry for this domain
    const site = sites.find((s) => {
      const siteDomain = s.domain.replace(/^www\./, "").toLowerCase();
      const currentDomain = hostname.replace(/^www\./, "").toLowerCase();
      return (
        siteDomain === currentDomain ||
        currentDomain.endsWith("." + siteDomain)
      );
    });

    // Site not in list or toggled off — strip nothing, no overlay
    if (!site || site.active === false) {
      clearAllStripAttributes();
      removeExistingOverlay();
      return;
    }

    // Restriction level decides what this script does:
    //   strip / friction → strip elements (friction shows the delay
    //                      overlay first, then lands on the stripped page)
    //   block            → nothing; background.js already redirected
    //                      this tab to blocked.html. Also drop any live
    //                      overlay — flipping a page to Block mid-countdown
    //                      must not leave the interstitial standing.
    const restrictionLevel = site.restrictionLevel || "strip";
    if (restrictionLevel === "block") {
      clearAllStripAttributes();
      removeExistingOverlay();
      return;
    }

    // Get available elements for this platform
    const availableElements = getAvailableElements(hostname);
    if (!availableElements) {
      // Not a supported platform — clear any attributes
      clearAllStripAttributes();
      return;
    }

    // Get stripping profile (use stored profile or default: all enabled)
    const profile = site?.strippingProfile || {};

    // Show interstitial overlay BEFORE setting stripping attributes.
    // The once-per-URL guard inside keeps it from reappearing when
    // this function re-runs for the same page (storage onChanged,
    // yt-page-data-updated); a real URL change re-applies it.
    showInterstitialIfNeeded(site);

    // Set attributes for each available element
    availableElements.forEach((elementName) => {
      // Default to enabled (true) if not explicitly set to false
      const enabled = profile[elementName] !== false;
      setStripAttribute(elementName, enabled);
    });
  } catch (err) {
    // Storage read failed — apply default profile (all enabled)
    const availableElements = getAvailableElements(hostname);
    if (availableElements) {
      availableElements.forEach((elementName) => {
        setStripAttribute(elementName, true);
      });
    }
  }
}

// ── Initialization ──────────────────────────────────────
// 1. Apply stripping profile from storage.
// 2. Listen for YouTube's SPA navigation event to re-apply
//    attributes when the page content changes.
// 3. Listen for storage changes (profile updates from popup).

applyStrippingProfile();

// YouTube SPA navigation — fires on every in-app page change
// (watch → home → search → etc.). Re-apply attributes to
// ensure stripping persists across navigation.
window.addEventListener("yt-page-data-updated", () => {
  // Small delay to let YouTube finish rendering the new page
  setTimeout(applyStrippingProfile, 100);
});

// Listen for storage changes (profile updates from popup)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  // Re-apply when sites change (toggle, profile, mode) or master toggle flips
  if (changes.sites || changes.enabled) {
    applyStrippingProfile();
  }
});
