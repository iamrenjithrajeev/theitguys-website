/*
 * Tiny runtime for the demo screens in /demo/screens.
 * Each screen file holds an <x-dc> template ({{holes}}, <sc-if>, <sc-for>,
 * onClick handlers) plus a "class Component extends DCLogic" script.
 * This renders them into a page with plain DOM, no build step.
 */
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p);
      if (this.__mount) this.__mount.schedule();
    }
    forceUpdate() { if (this.__mount) this.__mount.schedule(); }
  }

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scopes) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    for (let i = scopes.length - 1; i >= 0; i--) {
      const sc = scopes[i];
      if (sc && Object.prototype.hasOwnProperty.call(sc, parts[0])) {
        let v = sc[parts[0]];
        for (let k = 1; k < parts.length; k++) v = v == null ? undefined : v[parts[k]];
        return v;
      }
    }
    return undefined;
  }

  function interp(str, scopes) {
    return str.replace(HOLE, (_, p) => { const v = lookup(p, scopes); return v == null ? '' : String(v); });
  }

  function renderNodes(nodes, parent, scopes) {
    nodes.forEach((n) => renderNode(n, parent, scopes));
  }

  function renderNode(node, parent, scopes) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      parent.appendChild(document.createTextNode(t.indexOf('{{') >= 0 ? interp(t, scopes) : t));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'helmet' || tag === 'script') return;
    if (tag === 'sc-if') {
      const m = (node.getAttribute('value') || '').match(WHOLE);
      if (m && lookup(m[1], scopes)) renderNodes(Array.from(node.childNodes), parent, scopes);
      return;
    }
    if (tag === 'sc-for') {
      const m = (node.getAttribute('list') || '').match(WHOLE);
      const list = m ? lookup(m[1], scopes) : null;
      const as = node.getAttribute('as') || 'item';
      (Array.isArray(list) ? list : []).forEach((item, i) => {
        const local = { $index: i }; local[as] = item;
        renderNodes(Array.from(node.childNodes), parent, scopes.concat([local]));
      });
      return;
    }
    const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName)
      : document.createElement(tag);
    Array.from(node.attributes).forEach((a) => {
      const name = a.name;
      if (name.indexOf('hint-') === 0) return;
      const whole = a.value.match(WHOLE);
      if (name.indexOf('on') === 0 && whole) {
        const fn = lookup(whole[1], scopes);
        if (typeof fn === 'function') {
          el.addEventListener(name.slice(2).toLowerCase(), (e) => {
            if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
            fn(e);
          });
        }
        return;
      }
      const v = a.value.indexOf('{{') >= 0 ? interp(a.value, scopes) : a.value;
      el.setAttribute(name, v);
    });
    if (tag === 'a' && el.getAttribute('href') === '#' && !node.getAttribute('onclick')) {
      el.addEventListener('click', (e) => e.preventDefault());
    }
    renderNodes(Array.from(node.childNodes), el, scopes);
    parent.appendChild(el);
  }

  const loadedHead = new Set();

  async function mountScreen(url, target, props, opts) {
    opts = opts || {};
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load ' + url);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector('helmet');
    if (helmet) {
      Array.from(helmet.children).forEach((h) => {
        if (h.localName === 'link' && !loadedHead.has(h.getAttribute('href'))) {
          loadedHead.add(h.getAttribute('href'));
          const l = document.createElement('link');
          Array.from(h.attributes).forEach((a) => l.setAttribute(a.name, a.value));
          document.head.appendChild(l);
        }
      });
    }
    const template = Array.from(xdc.childNodes).filter((n) => !(n.nodeType === 1 && n.localName === 'helmet'));
    const src = doc.querySelector('script[data-dc-script]').textContent;
    const Component = new Function('DCLogic', src + '\n;return Component;')(DCLogic);
    const inst = new Component(props || {});
    let queued = false;
    const mount = {
      schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; draw(); });
      }
    };
    inst.__mount = mount;
    function draw() {
      const scrollers = Array.from(target.querySelectorAll('*')).map((e) => e.scrollTop);
      const frag = document.createDocumentFragment();
      renderNodes(template, frag, [inst.renderVals()]);
      target.replaceChildren(frag);
      if (opts.fill) {
        const root = target.firstElementChild;
        if (root) { root.style.width = '100%'; root.style.height = '100%'; }
      }
      const now = Array.from(target.querySelectorAll('*'));
      scrollers.forEach((top, i) => { if (top && now[i]) now[i].scrollTop = top; });
    }
    draw();
    return inst;
  }

  window.DemoRuntime = { mountScreen: mountScreen };
})();
