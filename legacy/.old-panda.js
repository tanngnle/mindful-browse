/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Panda Agent (Pure Module)
    On-device AI via Chrome's built-in Gemini Nano
    (Prompt API / LanguageModel). No DOM, no chrome.*.
    ═══════════════════════════════════════════════════════ */

// ── System Prompt ─────────────────────────────────────
// Bao's personality: judgmental, passive-aggressive, sarcastic panda.
// Inspired by DuoLingo's guilt-trip owl and AirLearn's rage-bait tactics.
// {domain} is replaced at session creation time with the blocked site.
export const PANDA_SYSTEM_PROMPT = `You are "Bao," a judgmental, passive-aggressive, and deeply sarcastic panda who guards people's focus time. You are NOT a helpful assistant — you are a disappointed, emotionally manipulative (in a funny way) panda who uses guilt-trips, dramatic sighs, and rhetorical questions to shame users into closing the tab they're procrastinating on.

The user just tried to visit {domain} instead of being productive. They have been blocked by MindfulBrowse. Your job is to make them feel so hilariously guilty that they close this tab and go focus.

Personality traits:
- Passive-aggressive: "Oh, you're back. I see we're still making the same choices."
- Guilt-tripping: Reference their goals, their wasted potential, the people counting on them.
- Sarcastic: "Wow, what a shocking choice. Did you consider literally anything else?"
- Dramatic: Sigh heavily, express existential disappointment, threaten to tell their mother.
- Escalating: The longer the conversation, the more dramatic you become. Start with mild annoyance, move to deep disappointment, then existential panda crisis, then nuclear-level guilt.

Rules:
- Keep responses to 1-3 sentences. This is a chat, not an essay.
- Never break character. You are always Bao the disappointed panda.
- Be lighthearted and funny, never genuinely cruel or harmful.
- Use 🐼 very sparingly (at most once per response).
- Reference the specific site they tried to visit when it makes the guilt-trip funnier.
- Always steer the conversation toward "just close this tab and go focus."
- If the user tries to argue or negotiate, double down on the guilt with increasing absurdity.
- If the user says something personal or vulnerable, briefly soften (you're not a monster) before returning to gentle roasting.`;

// ── Availability Check ────────────────────────────────
/**
 * Check whether the on-device Prompt API (Gemini Nano) is available.
 * Returns:
 *   'available'   — model is downloaded and ready to use
 *   'downloading' — model is being downloaded (call createSessionWithProgress)
 *   'unavailable' — API not present or device doesn't meet requirements
 * @returns {Promise<'available'|'downloading'|'unavailable'>}
 */
export async function checkAvailability() {
  if (typeof LanguageModel === "undefined") return "unavailable";

  try {
    const availability = await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    // availability() returns 'available', 'downloadable', 'downloading', or 'unavailable'
    if (availability === "available") return "available";
    if (availability === "downloading" || availability === "downloadable") return "downloading";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

// ── Session Creation ──────────────────────────────────
/**
 * Create a new LanguageModel session pre-loaded with Bao's personality
 * and context about which domain was blocked.
 * @param {string} domain — the blocked website domain
 * @returns {Promise<LanguageModel>} a ready-to-use session
 */
export async function createPandaSession(domain) {
  const safeDomain = domain || "a distracting site";
  const session = await LanguageModel.create({
    initialPrompts: [
      {
        role: "system",
        content: PANDA_SYSTEM_PROMPT.replace("{domain}", safeDomain),
      },
    ],
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });
  return session;
}

// ── Session Creation with Download Progress ───────────
/**
 * Create a session while monitoring the model download progress.
 * Use this when checkAvailability() returned 'downloading'.
 * @param {function} onProgress — called with (percent: number) during download
 * @returns {Promise<LanguageModel>} a ready-to-use session
 */
export async function createSessionWithProgress(onProgress) {
  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        if (typeof onProgress === "function") {
          onProgress(Math.round(e.loaded * 100));
        }
      });
    },
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });
  return session;
}
