# Privacy Form — MindfulBrowse

> Fill these into the Chrome Web Store "Privacy" tab.
> IMPORTANT: The "remote code" radio is currently set to "Yes" — change it to "No".

## Single Purpose Description (REQUIRED)
```
Block distracting websites and replace them with a Pomodoro timer to help users stay focused and build healthier browsing habits.
```

## Permission Justifications

### storage (REQUIRED)
```
The "storage" permission (chrome.storage.local and chrome.storage.sync) is used to persist the user's configuration: the list of blocked domains, Pomodoro timer settings (work duration, break length), enabled/disabled state, friction rules, and scheduling rules. This data must survive browser restarts and sync across the user's devices (via sync storage) so their focus settings follow them everywhere.
```

### webNavigation (REQUIRED)
```
The "webNavigation" permission is required to intercept navigation events before they complete. When a user navigates to a blocked domain, the background service worker uses the webNavigation.onBeforeNavigate listener to detect the URL match and redirect the tab to the local Pomodoro timer page instead of allowing the distracting site to load. Without this permission, the extension cannot intercept and redirect navigation in real time.
```

### Host permission (REQUIRED)
The content_scripts in manifest.json match `*://*.youtube.com/*` and `*://*.facebook.com/*`.

```
Host permissions for youtube.com and facebook.com are required for the content script "strip mode" feature. The content script injects CSS and JavaScript that hides distracting UI elements (recommended video sidebars, news feed, notifications) on these sites while preserving core functionality (video playback on YouTube, messaging on Facebook). This gives users a middle ground between full blocking and unrestricted access. The <all_urls> match in web_accessible_resources is needed so the blocked-page timer HTML/CSS/JS can be loaded when any blocked domain is intercepted.
```

## Remote Code (MUST CHANGE)

**Current (WRONG):** "Yes, I am using remote code"
**Change to:** "No, I am not using remote code"

> MindfulBrowse makes ZERO network requests. All fonts are self-hosted in the fonts/ directory. All JavaScript is bundled in the extension package. There are no external CDN references, no eval(), no remote script tags.

## Data Usage

**All checkboxes should remain UNCHECKED** — the extension collects no user data.

## Certification Checkboxes (MUST CHECK ALL THREE)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy Policy URL

Since no data is collected, a privacy policy is technically not required. However, adding one is good practice. Options:

**Option A — Use the GitHub repo:**
```
https://github.com/tanngnle/mindful-browse/blob/main/PRIVACY.md
```
(You'd need to create a PRIVACY.md in the repo)

**Option B — Leave blank** (acceptable since no data is collected)
