// The web UI's only stylesheet. WebUi injects it as a <style> on start and
// removes it on stop. It is a String.raw template literal: never use a
// backtick or ${ in it.
//
// One theme, on purpose: a cool slate between light and dark (surfaces sit
// around L* 24-37), so switching to it from either a light or a dark page is
// not jarring. Text pairs meet WCAG AA (4.5:1) on every surface they sit on.
export const WEBUI_CSS = String.raw`
.webui {
  --bg: #3b4352;
  --surface: #454e5e;
  --raised: #4d5667;
  --inset: #333a47;
  --border: #565f70;
  --border-soft: #4c5464;
  --text: #eef2f7;
  --muted: #c4ccd8;
  --accent: #82b4ff;
  --accent-ink: #0f1b2d;
  --accent-text: #a8cbff;
  --accent-soft: #465878;
  --danger: #ffb1a9;
  --warn: #f2c46d;
  --ok: #86dba5;
  --shadow: 0 1px 2px rgb(10 14 22 / 0.25), 0 4px 14px rgb(10 14 22 / 0.12);
  --radius: 12px;
  --radius-sm: 8px;
  --gap: 12px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  color-scheme: dark;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
}

.webui *,
.webui *::before,
.webui *::after {
  box-sizing: border-box;
}

.webui [hidden] {
  display: none !important;
}

.webui ::selection {
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}

/* Header and tabs */

.webui .top {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border-soft);
  box-shadow: 0 2px 12px rgb(10 14 22 / 0.18);
}

.webui .header,
.webui .tabs,
.webui .view {
  max-width: 720px;
  margin: 0 auto;
}

.webui .view {
  padding: calc(var(--gap) * 1.5) var(--gap);
  padding-bottom: calc(var(--gap) * 3);
}

.webui h2 {
  font-size: 1.15rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  margin: 2px 2px calc(var(--gap) * 1.25);
}

.webui .header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding: 12px var(--gap) 6px;
}

.webui .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.webui .brand strong {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.webui .brand strong::before {
  content: "";
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: linear-gradient(135deg, #a8cbff, #5f8fe0 55%, #4a6fb8);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
  transform: rotate(45deg) scale(0.82);
}

.webui .brand .mono {
  padding: 2px 8px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: var(--inset);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webui .header-row > button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.webui .header-row > button::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
}

.webui .header-row > button.syncing {
  color: var(--accent-text);
}

.webui .header-row > button.syncing::before {
  background: var(--accent);
  animation: webui-pulse 1s ease-in-out infinite;
}

@keyframes webui-pulse {
  50% { opacity: 0.25; }
}

.webui .error-line {
  margin: 4px var(--gap) 6px;
  padding: 7px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--danger) 14%, var(--surface));
  color: var(--danger);
  font-size: 0.85rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.webui .tabs {
  display: flex;
  padding: 0 calc(var(--gap) / 2);
}

.webui .tab {
  position: relative;
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 4px 12px;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--muted);
  font-weight: 500;
}

.webui .tab:hover {
  background: none;
  color: var(--text);
}

.webui .tab::after {
  content: "";
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: transparent;
  transition: background-color 0.15s;
}

.webui .tab[aria-selected="true"] {
  color: var(--text);
  font-weight: 600;
}

.webui .tab[aria-selected="true"]::after {
  background: var(--accent);
}

.webui .badge {
  display: inline-block;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.5;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Controls */

.webui button,
.webui input,
.webui select,
.webui textarea {
  font: inherit;
  color: inherit;
}

.webui button {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s, color 0.12s;
}

.webui button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--raised) 85%, white);
}

.webui button:disabled {
  opacity: 0.55;
  cursor: default;
}

.webui button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}

.webui button.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 85%, white);
}

.webui button.ghost {
  background: transparent;
  border-color: var(--border);
}

.webui button.ghost:hover:not(:disabled) {
  background: var(--raised);
}

.webui button.danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}

.webui button.danger:not(.ghost) {
  background: color-mix(in srgb, var(--danger) 16%, var(--surface));
}

.webui button.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 24%, var(--surface));
}

.webui button.wide {
  width: 100%;
  margin-top: var(--gap);
}

.webui button:focus-visible,
.webui input:focus-visible,
.webui select:focus-visible,
.webui textarea:focus-visible,
.webui summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.webui input[type="text"],
.webui input[type="url"],
.webui input[type="password"],
.webui select,
.webui textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--inset);
  transition: border-color 0.12s, box-shadow 0.12s;
}

.webui input[type="text"]:focus,
.webui input[type="url"]:focus,
.webui input[type="password"]:focus,
.webui select:focus,
.webui textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  outline: none;
}

.webui ::placeholder {
  color: var(--muted);
  opacity: 0.8;
}

.webui input[type="file"] {
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: var(--inset);
  color: var(--muted);
}

.webui input[type="file"]::file-selector-button {
  margin-right: 12px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--raised);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.webui textarea {
  resize: vertical;
  min-height: 84px;
}

.webui form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.webui .form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.webui .form-status {
  font-size: 0.85rem;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.webui .form-status:empty {
  display: none;
}

.webui .segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--inset);
}

.webui .segmented button {
  padding: 4px 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}

.webui .segmented button:hover:not(:disabled) {
  background: transparent;
  color: var(--text);
}

.webui .segmented button[aria-pressed="true"],
.webui .segmented button[aria-pressed="true"]:hover {
  background: var(--raised);
  color: var(--text);
  box-shadow: 0 1px 2px rgb(10 14 22 / 0.3);
}

/* Lists and cards */

.webui .list,
.webui .messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.webui .card {
  padding: calc(var(--gap) * 1.25);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.webui .card + .card,
.webui .list + .card {
  margin-top: var(--gap);
}

.webui .card p {
  margin: 0.6em 0;
}

.webui .row {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  padding: 12px var(--gap);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  text-align: left;
}

.webui .row:hover:not(:disabled) {
  background: var(--raised);
  border-color: var(--border);
}

.webui .row.unread {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-soft));
}

.webui .row.unread .row-primary {
  font-weight: 700;
}

.webui .row-main {
  flex: 1;
}

.webui .row-main,
.webui .thread-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.webui .row-main > *,
.webui .thread-title > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webui .avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: hsl(var(--hue, 215) 34% 72%);
  color: hsl(var(--hue, 215) 55% 16%);
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
}

.webui .avatar.mono {
  font-size: 0.8rem;
  text-transform: none;
}

.webui .eyebrow {
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.webui .row-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.webui .empty {
  padding: calc(var(--gap) * 3) var(--gap);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  text-align: center;
}

/* Relays */

.webui .relay {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.webui .relay .form-row {
  justify-content: flex-start;
  margin-top: 8px;
}

.webui .relay.disabled {
  box-shadow: none;
  background: color-mix(in srgb, var(--surface) 50%, var(--bg));
}

.webui .relay.disabled .relay-url {
  color: var(--muted);
  text-decoration: line-through;
}

.webui .relay-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 14px;
  margin: 4px 0;
}

.webui .relay-meta dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.webui .token-editor summary {
  width: fit-content;
  cursor: pointer;
  color: var(--accent-text);
}

.webui .token-editor form {
  margin-top: 8px;
}

.webui .relay-url {
  font-family: var(--mono);
  font-size: 0.95rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* Thread */

.webui .thread-head {
  display: flex;
  align-items: center;
  gap: var(--gap);
  margin-bottom: var(--gap);
}

.webui .thread-title {
  flex: 1;
}

.webui .thread-name {
  font-size: 1.05rem;
  font-weight: 650;
}

.webui .rename {
  display: flex;
  flex-direction: row;
  flex: 1;
  gap: 8px;
  min-width: 0;
}

.webui .rename input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
}

.webui .compose {
  margin-bottom: calc(var(--gap) * 1.5);
}

.webui .thread-head + .compose {
  padding: var(--gap);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.webui .card > .compose {
  margin-bottom: 0;
}

.webui .message {
  max-width: 80%;
  padding: 8px 13px 9px;
  border-radius: 16px;
  border: 1px solid var(--border-soft);
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(10 14 22 / 0.2);
}

.webui .message.outbound {
  align-self: flex-end;
  border-color: color-mix(in srgb, var(--accent) 30%, var(--accent-soft));
  border-bottom-right-radius: 5px;
  background: var(--accent-soft);
}

.webui .message.inbound {
  align-self: flex-start;
  border-bottom-left-radius: 5px;
}

.webui .message-meta {
  font-size: 0.72rem;
  margin-bottom: 2px;
  font-variant-numeric: tabular-nums;
}

.webui .message.outbound .message-meta {
  color: color-mix(in srgb, var(--muted) 70%, white);
}

.webui .message .text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.webui .download {
  margin: 4px 0 2px;
}

.webui .download::before {
  content: "\2193";
  margin-right: 8px;
  color: var(--accent-text);
  font-weight: 700;
}

/* Identity */

.webui .label {
  font-weight: 650;
  margin-bottom: 4px;
}

.webui .key {
  display: block;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--inset);
  overflow-wrap: anywhere;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}

.webui .mono,
.webui code {
  font-family: var(--mono);
}

.webui strong {
  color: var(--text);
}

.webui .muted { color: var(--muted); }
.webui .small { font-size: 0.85rem; }
.webui .error { color: var(--danger); }
.webui .warn { color: var(--warn); }
.webui .ok { color: var(--ok); }

@media (max-width: 480px) {
  .webui { --gap: 10px; }
  .webui .message { max-width: 90%; }
  .webui .tab { font-size: 0.9rem; }
  .webui .avatar { width: 34px; height: 34px; }
}

@media (prefers-reduced-motion: reduce) {
  .webui *,
  .webui *::before,
  .webui *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
