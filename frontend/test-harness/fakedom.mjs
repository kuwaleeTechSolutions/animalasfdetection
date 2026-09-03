// =====================================================================================
// Minimal fake DOM sufficient to execute the frontend page modules headlessly (no
// jsdom available in this sandbox). Supports: document.getElementById, innerHTML
// get/set (parses out elements with ids so getElementById keeps working after a
// render), querySelector/querySelectorAll (basic selectors: #id, tag, [attr],
// [attr="val"], .class combinations used in this codebase), addEventListener,
// classList add/remove/contains, and localStorage.
// This is NOT a full DOM -- just enough surface for smoke-testing render logic and
// catching reference errors / null-access bugs before shipping.
// =====================================================================================

class FakeClassList {
  constructor(el) { this.el = el; }
  add(...cls) { cls.forEach((c) => { if (!this.el._classes.has(c)) this.el._classes.add(c); }); }
  remove(...cls) { cls.forEach((c) => this.el._classes.delete(c)); }
  contains(c) { return this.el._classes.has(c); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this._children = [];
    this._attrs = {};
    this._classes = new Set();
    this._listeners = {};
    this._value = '';
    this._innerHTML = '';
    this.style = {};
  }
  get classList() { return new FakeClassList(this); }
  get className() { return Array.from(this._classes).join(' '); }
  set className(val) { this._classes = new Set(String(val).split(/\s+/).filter(Boolean)); }
  set innerHTML(html) {
    this._innerHTML = html;
    this._children = parseElements(html);
  }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this._children.push(child); return child; }
  remove() { /* no-op for fake root-level nodes */ }
  addEventListener(type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); }
  dispatchEvent(type, ev = {}) { (this._listeners[type] || []).forEach((cb) => cb(ev)); }
  setAttribute(name, val) { this._attrs[name] = String(val); }
  getAttribute(name) { return this._attrs[name] ?? null; }
  querySelector(sel) { return querySelectorAll(this._children, sel)[0] || null; }
  querySelectorAll(sel) { return querySelectorAll(this._children, sel); }
  get value() { return this._value; }
  set value(v) { this._value = v; }
  get clientWidth() { return 800; }
  get clientHeight() { return 420; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 420 }; }
}

// Extremely small HTML "parser": extracts elements with id="..." attributes and basic
// tag/class/attr info so that getElementById / querySelector(#id) keep working after
// innerHTML is set to a big template string. It does NOT build a full tree -- good
// enough for smoke testing since our code mostly looks elements up by id or by a
// data-* attribute selector immediately after rendering.
function parseElements(html) {
  const elements = [];
  const tagRegex = /<(\w[\w-]*)\b([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(html))) {
    const [, tag, attrsStr] = match;
    const el = new FakeElement(tag);
    const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(attrsStr))) {
      el._attrs[am[1]] = am[2];
      if (am[1] === 'class') am[2].split(/\s+/).forEach((c) => c && el._classes.add(c));
    }
    elements.push(el);
  }
  return elements;
}

function matchesSimplePart(el, part) {
  if (part.startsWith('#')) return el._attrs.id === part.slice(1);
  if (part.startsWith('.')) return el._classes.has(part.slice(1));
  if (part.startsWith('[')) {
    const inner = part.slice(1, -1);
    const eqMatch = inner.match(/^([\w-]+)="([^"]*)"$/);
    if (eqMatch) return el._attrs[eqMatch[1]] === eqMatch[2];
    return el._attrs[inner] !== undefined;
  }
  return el.tagName === part.toUpperCase();
}

// Supports compound selectors used in this codebase, e.g. `select[name="x"]`,
// `div.card#foo`, `[data-task-id]` -- splits into parts (tag, .class, [attr=val], #id)
// and requires ALL parts to match the same element (a real CSS "compound selector").
function matchesSelector(el, sel) {
  const partRegex = /(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])|^([\w-]+)/g;
  const parts = sel.match(partRegex) || [sel];
  return parts.every((part) => matchesSimplePart(el, part));
}

function querySelectorAll(pool, sel) {
  return pool.filter((el) => matchesSelector(el, sel));
}

class FakeDocument {
  constructor() {
    this._byId = new Map();
    this.root = new FakeElement('div');
    this.root.setAttribute('id', 'root');
    this._byId.set('root', this.root);
  }
  getElementById(id) {
    if (this._byId.has(id)) return this._byId.get(id);
    // Look inside root's rendered children (from last innerHTML set).
    const found = this._searchTree(this.root, id);
    return found;
  }
  _searchTree(el, id) {
    for (const child of el._children || []) {
      if (child._attrs && child._attrs.id === id) return child;
    }
    return null;
  }
  createElement(tag) { return new FakeElement(tag); }
  querySelector(sel) { return this.root.querySelector(sel); }
  querySelectorAll(sel) { return this.root.querySelectorAll(sel); }
  addEventListener() {}
  get body() { return this.root; }
}

class FakeLocalStorage {
  constructor() { this._map = new Map(); }
  getItem(k) { return this._map.has(k) ? this._map.get(k) : null; }
  setItem(k, v) { this._map.set(k, String(v)); }
  removeItem(k) { this._map.delete(k); }
}

export function installFakeDom(baseUrl) {
  const doc = new FakeDocument();
  globalThis.document = doc;
  globalThis.window = {
    location: { hash: '', href: baseUrl, reload() {} },
    addEventListener() {},
  };
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.history = { back() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (path, opts) => realFetch(new URL(path, baseUrl).toString(), opts);
  return doc;
}
