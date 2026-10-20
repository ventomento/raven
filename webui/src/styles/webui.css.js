// The web UI's only stylesheet. WebUi injects it as a <style> on start and
// removes it on stop. It is a String.raw template literal: never use a
// backtick or ${ in it.
export const WEBUI_CSS = String.raw`
.webui {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --text: #1b1f24;
  --muted: #6a737d;
  --border: #e1e4e8;
  --accent: #2f6fec;
  --accent-text: #ffffff;
  --accent-soft: #e8effd;
  --danger: #c93c37;
  --warn: #b26b00;
  --ok: #1f883d;
  --radius: 10px;
  --gap: 12px;

  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

@media (prefers-color-scheme: dark) {
  .webui {
    --bg: #0f1216;
    --surface: #181c22;
    --text: #e6e8eb;
    --muted: #8b949e;
    --border: #2a3038;
    --accent: #5b8def;
    --accent-soft: #1d2a42;
    --danger: #f0716b;
    --warn: #e3a33b;
    --ok: #4cc56a;
    color-scheme: dark;
  }
}

.webui *,
.webui *::before,
.webui *::after {
  box-sizing: border-box;
}

.webui [hidden] {
  display: none !important;
}

.webui .top {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.webui .header,
.webui .tabs,
.webui .view {
  max-width: 720px;
  margin: 0 auto;
}

.webui .view {
  padding: var(--gap);
  padding-bottom: calc(var(--gap) * 3);
}

.webui h2 {
  font-size: 1.1rem;
  margin: 4px 0 var(--gap);
}

.webui .header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding: 10px var(--gap);
}

.webui .brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.webui .brand strong {
  font-size: 1.05rem;
}

.webui .syncing {
  color: var(--accent);
}

.webui .error-line {
  padding: 6px var(--gap);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 0.85rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.webui .tabs {
  display: flex;
}

.webui .tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: none;
  color: var(--muted);
  font-weight: 500;
}

.webui .tab[aria-selected="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.webui .badge {
  display: inline-block;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
}

.webui button,
.webui input,
.webui select,
.webui textarea {
  font: inherit;
  color: inherit;
}

.webui button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.webui button:disabled {
  opacity: 0.6;
  cursor: default;
}

.webui button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.webui button.ghost {
  background: transparent;
}

.webui button.danger {
  color: var(--danger);
}

.webui button.wide {
  width: 100%;
  margin-top: var(--gap);
}

.webui button:focus-visible,
.webui input:focus-visible,
.webui select:focus-visible,
.webui textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.webui input[type="text"],
.webui input[type="url"],
.webui input[type="password"],
.webui select,
.webui textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.webui input[type="file"] {
  width: 100%;
  padding: 8px 0;
}

.webui textarea {
  resize: vertical;
  min-height: 80px;
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.webui .segmented button {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
}

.webui .segmented button[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

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
  padding: var(--gap);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.webui .card + .card,
.webui .list + .card {
  margin-top: var(--gap);
}

.webui .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  width: 100%;
  padding: 14px var(--gap);
  text-align: left;
}

.webui .row.unread .row-primary {
  font-weight: 700;
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

.webui .eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.webui .row-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 0.85rem;
}

.webui .empty {
  padding: calc(var(--gap) * 2) var(--gap);
  color: var(--muted);
  text-align: center;
}

.webui .relay {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.webui .relay .form-row {
  justify-content: flex-start;
  margin-top: 6px;
}

.webui .relay.disabled .relay-url {
  color: var(--muted);
  text-decoration: line-through;
}

.webui .relay-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 10px;
  margin: 0;
}

.webui .relay-meta dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.webui .token-editor summary {
  cursor: pointer;
  color: var(--muted);
}

.webui .token-editor form {
  margin-top: 6px;
}

.webui .relay-url {
  font-weight: 600;
  overflow-wrap: anywhere;
}

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
  font-weight: 600;
}

.webui .rename {
  display: flex;
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

.webui .card > .compose {
  margin-bottom: 0;
}

.webui .message {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
}

.webui .message.outbound {
  align-self: flex-end;
  background: var(--accent-soft);
  border-color: transparent;
}

.webui .message.inbound {
  align-self: flex-start;
}

.webui .message-meta {
  font-size: 0.75rem;
  margin-bottom: 2px;
}

.webui .message .text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.webui .download {
  margin-top: 4px;
}

.webui .label {
  font-weight: 600;
  margin-bottom: 4px;
}

.webui .key {
  display: block;
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--bg);
  overflow-wrap: anywhere;
  font-size: 0.85rem;
}

.webui .mono,
.webui code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.webui .muted { color: var(--muted); }
.webui .small { font-size: 0.85rem; }
.webui .error { color: var(--danger); }
.webui .warn { color: var(--warn); }
.webui .ok { color: var(--ok); }

@media (max-width: 480px) {
  .webui { --gap: 10px; }
  .webui .message { max-width: 92%; }
  .webui .tab { font-size: 0.9rem; }
}
`;
