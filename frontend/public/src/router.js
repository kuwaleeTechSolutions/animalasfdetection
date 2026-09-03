// =====================================================================================
// Minimal hash-based router.
// =====================================================================================

const routes = [];

export function route(pattern, handler) {
  // pattern like '/cases/:id' -> regex with named groups
  const paramNames = [];
  const regexStr = '^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$';
  routes.push({ regex: new RegExp(regexStr), paramNames, handler });
}

export function navigate(path) {
  window.location.hash = path;
}

export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

let onChangeCb = null;
export function onRouteChange(cb) {
  onChangeCb = cb;
  window.addEventListener('hashchange', dispatch);
}

export function dispatch() {
  const path = currentPath();
  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      if (onChangeCb) onChangeCb(path);
      r.handler(params);
      return;
    }
  }
  // no match -> 404-ish fallback, handled by caller via a wildcard route registered last
}
