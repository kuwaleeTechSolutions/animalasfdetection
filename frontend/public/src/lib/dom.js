// =====================================================================================
// Tiny render helper: components are just functions returning HTML strings.
// State changes call `rerender()` which re-renders the current route's component into
// #app-content. Event handling uses delegation via data-action attributes + a global
// click/submit/input listener registered once in main.js. This mirrors a React
// function-component mental model (props in, HTML out) without requiring JSX/a
// bundler -- see index.html for the sandbox-constraint rationale.
// =====================================================================================

export function el(id) {
  return document.getElementById(id);
}

export function qs(root, selector) {
  return root.querySelector(selector);
}

export function qsa(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

/** Escapes a value for safe interpolation into an HTML template string. */
export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(seconds) {
  if (seconds == null) return '\u2014';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

let toastTimeout = null;
export function showToast(message, isError = false) {
  let toastEl = el('global-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'global-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toastEl.style.display = 'none'; }, 3500);
}
