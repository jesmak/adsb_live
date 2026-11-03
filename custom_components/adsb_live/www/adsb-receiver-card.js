/*! adsb-receiver-card 1.4.0 | MIT License */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i5 = decorators.length - 1, decorator; i5 >= 0; i5--)
    if (decorator = decorators[i5])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = /* @__PURE__ */ Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t3, e5, o6) {
    if (this._$cssResult$ = true, o6 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t3, this.t = e5;
  }
  get styleSheet() {
    let t3 = this.o;
    const s4 = this.t;
    if (e && void 0 === t3) {
      const e5 = void 0 !== s4 && 1 === s4.length;
      e5 && (t3 = o.get(s4)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e5 && o.set(s4, t3));
    }
    return t3;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t3) => new n("string" == typeof t3 ? t3 : t3 + "", void 0, s);
var i = (t3, ...e5) => {
  const o6 = 1 === t3.length ? t3[0] : e5.reduce((e6, s4, o7) => e6 + ((t4) => {
    if (true === t4._$cssResult$) return t4.cssText;
    if ("number" == typeof t4) return t4;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t4 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t3[o7 + 1], t3[0]);
  return new n(o6, t3, s);
};
var S = (s4, o6) => {
  if (e) s4.adoptedStyleSheets = o6.map((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet);
  else for (const e5 of o6) {
    const o7 = document.createElement("style"), n5 = t.litNonce;
    void 0 !== n5 && o7.setAttribute("nonce", n5), o7.textContent = e5.cssText, s4.appendChild(o7);
  }
};
var c = e ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
  let e5 = "";
  for (const s4 of t4.cssRules) e5 += s4.cssText;
  return r(e5);
})(t3) : t3;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t3, s4) => t3;
var u = { toAttribute(t3, s4) {
  switch (s4) {
    case Boolean:
      t3 = t3 ? l : null;
      break;
    case Object:
    case Array:
      t3 = null == t3 ? t3 : JSON.stringify(t3);
  }
  return t3;
}, fromAttribute(t3, s4) {
  let i5 = t3;
  switch (s4) {
    case Boolean:
      i5 = null !== t3;
      break;
    case Number:
      i5 = null === t3 ? null : Number(t3);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t3);
      } catch (t4) {
        i5 = null;
      }
  }
  return i5;
} };
var f = (t3, s4) => !i2(t3, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ?? (Symbol.metadata = /* @__PURE__ */ Symbol("metadata")), a.litPropertyMetadata ?? (a.litPropertyMetadata = /* @__PURE__ */ new WeakMap());
var y = class extends HTMLElement {
  static addInitializer(t3) {
    this._$Ei(), (this.l ?? (this.l = [])).push(t3);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t3, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t3, s4), !s4.noAccessor) {
      const i5 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t3, i5, s4);
      void 0 !== h3 && e2(this.prototype, t3, h3);
    }
  }
  static getPropertyDescriptor(t3, s4, i5) {
    const { get: e5, set: r6 } = h(this.prototype, t3) ?? { get() {
      return this[s4];
    }, set(t4) {
      this[s4] = t4;
    } };
    return { get: e5, set(s5) {
      const h3 = e5?.call(this);
      r6?.call(this, s5), this.requestUpdate(t3, h3, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t3) {
    return this.elementProperties.get(t3) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t3 = n2(this);
    t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t4 = this.properties, s4 = [...r2(t4), ...o2(t4)];
      for (const i5 of s4) this.createProperty(i5, t4[i5]);
    }
    const t3 = this[Symbol.metadata];
    if (null !== t3) {
      const s4 = litPropertyMetadata.get(t3);
      if (void 0 !== s4) for (const [t4, i5] of s4) this.elementProperties.set(t4, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t4, s4] of this.elementProperties) {
      const i5 = this._$Eu(t4, s4);
      void 0 !== i5 && this._$Eh.set(i5, t4);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i5 = [];
    if (Array.isArray(s4)) {
      const e5 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e5) i5.unshift(c(s5));
    } else void 0 !== s4 && i5.push(c(s4));
    return i5;
  }
  static _$Eu(t3, s4) {
    const i5 = s4.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t3) => this.enableUpdating = t3), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t3) => t3(this));
  }
  addController(t3) {
    (this._$EO ?? (this._$EO = /* @__PURE__ */ new Set())).add(t3), void 0 !== this.renderRoot && this.isConnected && t3.hostConnected?.();
  }
  removeController(t3) {
    this._$EO?.delete(t3);
  }
  _$E_() {
    const t3 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
    t3.size > 0 && (this._$Ep = t3);
  }
  createRenderRoot() {
    const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t3, this.constructor.elementStyles), t3;
  }
  connectedCallback() {
    this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(true), this._$EO?.forEach((t3) => t3.hostConnected?.());
  }
  enableUpdating(t3) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t3) => t3.hostDisconnected?.());
  }
  attributeChangedCallback(t3, s4, i5) {
    this._$AK(t3, i5);
  }
  _$ET(t3, s4) {
    const i5 = this.constructor.elementProperties.get(t3), e5 = this.constructor._$Eu(t3, i5);
    if (void 0 !== e5 && true === i5.reflect) {
      const h3 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
      this._$Em = t3, null == h3 ? this.removeAttribute(e5) : this.setAttribute(e5, h3), this._$Em = null;
    }
  }
  _$AK(t3, s4) {
    const i5 = this.constructor, e5 = i5._$Eh.get(t3);
    if (void 0 !== e5 && this._$Em !== e5) {
      const t4 = i5.getPropertyOptions(e5), h3 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== t4.converter?.fromAttribute ? t4.converter : u;
      this._$Em = e5;
      const r6 = h3.fromAttribute(s4, t4.type);
      this[e5] = r6 ?? this._$Ej?.get(e5) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t3, s4, i5, e5 = false, h3) {
    if (void 0 !== t3) {
      const r6 = this.constructor;
      if (false === e5 && (h3 = this[t3]), i5 ?? (i5 = r6.getPropertyOptions(t3)), !((i5.hasChanged ?? f)(h3, s4) || i5.useDefault && i5.reflect && h3 === this._$Ej?.get(t3) && !this.hasAttribute(r6._$Eu(t3, i5)))) return;
      this.C(t3, s4, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t3, s4, { useDefault: i5, reflect: e5, wrapped: h3 }, r6) {
    i5 && !(this._$Ej ?? (this._$Ej = /* @__PURE__ */ new Map())).has(t3) && (this._$Ej.set(t3, r6 ?? s4 ?? this[t3]), true !== h3 || void 0 !== r6) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t3, s4)), true === e5 && this._$Em !== t3 && (this._$Eq ?? (this._$Eq = /* @__PURE__ */ new Set())).add(t3));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t4) {
      Promise.reject(t4);
    }
    const t3 = this.scheduleUpdate();
    return null != t3 && await t3, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
        for (const [t5, s5] of this._$Ep) this[t5] = s5;
        this._$Ep = void 0;
      }
      const t4 = this.constructor.elementProperties;
      if (t4.size > 0) for (const [s5, i5] of t4) {
        const { wrapped: t5 } = i5, e5 = this[s5];
        true !== t5 || this._$AL.has(s5) || void 0 === e5 || this.C(s5, void 0, i5, e5);
      }
    }
    let t3 = false;
    const s4 = this._$AL;
    try {
      t3 = this.shouldUpdate(s4), t3 ? (this.willUpdate(s4), this._$EO?.forEach((t4) => t4.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t3 = false, this._$EM(), s5;
    }
    t3 && this._$AE(s4);
  }
  willUpdate(t3) {
  }
  _$AE(t3) {
    this._$EO?.forEach((t4) => t4.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t3) {
    return true;
  }
  update(t3) {
    this._$Eq && (this._$Eq = this._$Eq.forEach((t4) => this._$ET(t4, this[t4]))), this._$EM();
  }
  updated(t3) {
  }
  firstUpdated(t3) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ?? (a.reactiveElementVersions = [])).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t3) => t3;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3;
var u2 = Array.isArray;
var d2 = (t3) => u2(t3) || "function" == typeof t3?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t3) => (i5, ...s4) => ({ _$litType$: t3, strings: i5, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t3, i5) {
  if (!u2(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i5) : i5;
}
var N = (t3, i5) => {
  const s4 = t3.length - 1, e5 = [];
  let n5, l3 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c4 = v;
  for (let i6 = 0; i6 < s4; i6++) {
    const s5 = t3[i6];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n5 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n5 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n5 = void 0);
    const x2 = c4 === p2 && t3[i6 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e5.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i6 : x2);
  }
  return [V(t3, l3 + (t3[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e5];
};
var S2 = class _S {
  constructor({ strings: t3, _$litType$: i5 }, e5) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t3.length - 1, d3 = this.parts, [f3, v2] = N(t3, i5);
    if (this.el = _S.createElement(f3, e5), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
      const t4 = this.el.content.firstChild;
      t4.replaceWith(...t4.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t4 of r6.getAttributeNames()) if (t4.endsWith(h2)) {
          const i6 = v2[a3++], s4 = r6.getAttribute(t4).split(o3), e6 = /([.?@])?(.*)/.exec(i6);
          d3.push({ type: 1, index: l3, name: e6[2], strings: s4, ctor: "." === e6[1] ? I : "?" === e6[1] ? L : "@" === e6[1] ? z : H }), r6.removeAttribute(t4);
        } else t4.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t4));
        if (y2.test(r6.tagName)) {
          const t4 = r6.textContent.split(o3), i6 = t4.length - 1;
          if (i6 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i6; s4++) r6.append(t4[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t4[i6], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t4 = -1;
        for (; -1 !== (t4 = r6.data.indexOf(o3, t4 + 1)); ) d3.push({ type: 7, index: l3 }), t4 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t3, i5) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t3, s4;
  }
};
function M(t3, i5, s4 = t3, e5) {
  if (i5 === E) return i5;
  let h3 = void 0 !== e5 ? s4._$Co?.[e5] : s4._$Cl;
  const o6 = a2(i5) ? void 0 : i5._$litDirective$;
  return h3?.constructor !== o6 && (h3?._$AO?.(false), void 0 === o6 ? h3 = void 0 : (h3 = new o6(t3), h3._$AT(t3, s4, e5)), void 0 !== e5 ? (s4._$Co ?? (s4._$Co = []))[e5] = h3 : s4._$Cl = h3), void 0 !== h3 && (i5 = M(t3, h3._$AS(t3, i5.values), h3, e5)), i5;
}
var R = class {
  constructor(t3, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t3) {
    const { el: { content: i5 }, parts: s4 } = this._$AD, e5 = (t3?.creationScope ?? l2).importNode(i5, true);
    P.currentNode = e5;
    let h3 = P.nextNode(), o6 = 0, n5 = 0, r6 = s4[0];
    for (; void 0 !== r6; ) {
      if (o6 === r6.index) {
        let i6;
        2 === r6.type ? i6 = new k(h3, h3.nextSibling, this, t3) : 1 === r6.type ? i6 = new r6.ctor(h3, r6.name, r6.strings, this, t3) : 6 === r6.type && (i6 = new Z(h3, this, t3)), this._$AV.push(i6), r6 = s4[++n5];
      }
      o6 !== r6?.index && (h3 = P.nextNode(), o6++);
    }
    return P.currentNode = l2, e5;
  }
  p(t3) {
    let i5 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t3, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t3[i5])), i5++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t3, i5, s4, e5) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s4, this.options = e5, this._$Cv = e5?.isConnected ?? true;
  }
  get parentNode() {
    let t3 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === t3?.nodeType && (t3 = i5.parentNode), t3;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t3, i5 = this) {
    t3 = M(this, t3, i5), a2(t3) ? t3 === A || null == t3 || "" === t3 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t3 !== this._$AH && t3 !== E && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : d2(t3) ? this.k(t3) : this._(t3);
  }
  O(t3) {
    return this._$AA.parentNode.insertBefore(t3, this._$AB);
  }
  T(t3) {
    this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
  }
  _(t3) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(l2.createTextNode(t3)), this._$AH = t3;
  }
  $(t3) {
    const { values: i5, _$litType$: s4 } = t3, e5 = "number" == typeof s4 ? this._$AC(t3) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e5) this._$AH.p(i5);
    else {
      const t4 = new R(e5, this), s5 = t4.u(this.options);
      t4.p(i5), this.T(s5), this._$AH = t4;
    }
  }
  _$AC(t3) {
    let i5 = C.get(t3.strings);
    return void 0 === i5 && C.set(t3.strings, i5 = new S2(t3)), i5;
  }
  k(t3) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s4, e5 = 0;
    for (const h3 of t3) e5 === i5.length ? i5.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i5[e5], s4._$AI(h3), e5++;
    e5 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e5), i5.length = e5);
  }
  _$AR(t3 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t3 !== this._$AB; ) {
      const s5 = i3(t3).nextSibling;
      i3(t3).remove(), t3 = s5;
    }
  }
  setConnected(t3) {
    void 0 === this._$AM && (this._$Cv = t3, this._$AP?.(t3));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t3, i5, s4, e5, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e5, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t3, i5 = this, s4, e5) {
    const h3 = this.strings;
    let o6 = false;
    if (void 0 === h3) t3 = M(this, t3, i5, 0), o6 = !a2(t3) || t3 !== this._$AH && t3 !== E, o6 && (this._$AH = t3);
    else {
      const e6 = t3;
      let n5, r6;
      for (t3 = h3[0], n5 = 0; n5 < h3.length - 1; n5++) r6 = M(this, e6[s4 + n5], i5, n5), r6 === E && (r6 = this._$AH[n5]), o6 || (o6 = !a2(r6) || r6 !== this._$AH[n5]), r6 === A ? t3 = A : t3 !== A && (t3 += (r6 ?? "") + h3[n5 + 1]), this._$AH[n5] = r6;
    }
    o6 && !e5 && this.j(t3);
  }
  j(t3) {
    t3 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t3) {
    this.element[this.name] = t3 === A ? void 0 : t3;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t3) {
    this.element.toggleAttribute(this.name, !!t3 && t3 !== A);
  }
};
var z = class extends H {
  constructor(t3, i5, s4, e5, h3) {
    super(t3, i5, s4, e5, h3), this.type = 5;
  }
  _$AI(t3, i5 = this) {
    if ((t3 = M(this, t3, i5, 0) ?? A) === E) return;
    const s4 = this._$AH, e5 = t3 === A && s4 !== A || t3.capture !== s4.capture || t3.once !== s4.once || t3.passive !== s4.passive, h3 = t3 !== A && (s4 === A || e5);
    e5 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
  }
  handleEvent(t3) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t3) : this._$AH.handleEvent(t3);
  }
};
var Z = class {
  constructor(t3, i5, s4) {
    this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t3) {
    M(this, t3);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ?? (t2.litHtmlVersions = [])).push("3.3.3");
var D = (t3, i5, s4) => {
  const e5 = s4?.renderBefore ?? i5;
  let h3 = e5._$litPart$;
  if (void 0 === h3) {
    const t4 = s4?.renderBefore ?? null;
    e5._$litPart$ = h3 = new k(i5.insertBefore(c3(), t4), t4, void 0, s4 ?? {});
  }
  return h3._$AI(t3), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    var _a;
    const t3 = super.createRenderRoot();
    return (_a = this.renderOptions).renderBefore ?? (_a.renderBefore = t3.firstChild), t3;
  }
  update(t3) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ?? (s3.litElementVersions = [])).push("4.2.2");

// node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t3 = o5, e5, r6) => {
  const { kind: n5, metadata: i5 } = r6;
  let s4 = globalThis.litPropertyMetadata.get(i5);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i5, s4 = /* @__PURE__ */ new Map()), "setter" === n5 && ((t3 = Object.create(t3)).wrapped = true), s4.set(r6.name, t3), "accessor" === n5) {
    const { name: o6 } = r6;
    return { set(r7) {
      const n6 = e5.get.call(this);
      e5.set.call(this, r7), this.requestUpdate(o6, n6, t3, true, r7);
    }, init(e6) {
      return void 0 !== e6 && this.C(o6, void 0, t3, e6), e6;
    } };
  }
  if ("setter" === n5) {
    const { name: o6 } = r6;
    return function(r7) {
      const n6 = this[o6];
      e5.call(this, r7), this.requestUpdate(o6, n6, t3, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n5);
};
function n4(t3) {
  return (e5, o6) => "object" == typeof o6 ? r4(t3, e5, o6) : ((t4, e6, o7) => {
    const r6 = e6.hasOwnProperty(o7);
    return e6.constructor.createProperty(o7, t4), r6 ? Object.getOwnPropertyDescriptor(e6, o7) : void 0;
  })(t3, e5, o6);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// src/const.ts
var CARD_VERSION = "1.4.0";
var PLATFORM = "adsb_live";
var RECEIVER_MANUFACTURER = "readsb";
var SENSORS = [
  "aircraft_tracked",
  "aircraft_with_position",
  "messages_per_second",
  "positions_per_minute",
  "max_range",
  "signal",
  "noise"
];
var HISTORY_HOURS = 24;
var HISTORY_REFRESH_MS = 10 * 6e4;
var AIRCRAFT_REFRESH_MS = 1e4;
var RANGE_MINUTES = 15;
var METER_MIN_DBFS = -50;
var METER_MAX_DBFS = 0;

// src/aircraft.ts
var RECEIVER_AIRCRAFT_SERVICE = "get_receiver_aircraft";
function hasReceiverAircraft(hass) {
  return !!hass.services?.[PLATFORM]?.[RECEIVER_AIRCRAFT_SERVICE];
}
async function fetchReceiverAircraft(hass, device) {
  if (!hass.callWS) {
    throw new Error("Home Assistant has no websocket to ask with");
  }
  const result = await hass.callWS({
    type: "call_service",
    domain: PLATFORM,
    service: RECEIVER_AIRCRAFT_SERVICE,
    service_data: { device },
    return_response: true
  });
  const answer = result?.response;
  if (!answer || !Array.isArray(answer.aircraft)) {
    throw new Error("ADS-B Live answered without a list of aircraft");
  }
  return answer;
}
function byHeard(aircraft) {
  return [...aircraft].sort((one, other) => Date.parse(other.heard) - Date.parse(one.heard) || one.name.localeCompare(other.name));
}
function heardAgo(heard, now) {
  const seconds = Math.floor((now - Date.parse(heard)) / 1e3);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  if (seconds < 2) {
    return { unit: "now", value: 0 };
  }
  return seconds < 60 ? { unit: "seconds", value: seconds } : { unit: "minutes", value: Math.floor(seconds / 60) };
}

// src/localize/languages/en.json
var en_default = {
  common: {
    name: "ADS-B receiver",
    description: "The state of an ADS-B receiver from the ADS-B Live integration",
    invalid_configuration: "Invalid configuration. Pick a receiver.",
    invalid_height: "Invalid height. height and max_height must be positive numbers of pixels, and height_mode auto, fixed or max.",
    invalid_row_step: "Invalid rounding. row_step must be full or half.",
    no_receiver: "Receiver not found",
    no_entity: "Entity {entity} not found"
  },
  status: {
    receiving: "Receiving",
    quiet: "Quiet",
    unavailable: "Unavailable"
  },
  rates: {
    messages: "{value} msg/s",
    positions: "{value} positions/min",
    positions_one: "{value} position/min"
  },
  figures: {
    tracked: "tracked",
    with_position: "with a position",
    range: "range, {minutes}\xA0min"
  },
  curve: {
    past: "{hours} h ago",
    now: "now",
    peak: "peak {value}",
    point: "{time} \xB7 {value} tracked on average",
    point_now: "now \xB7 {value} tracked"
  },
  meter: {
    signal: "Signal",
    noise: "Noise",
    signal_unknown: "Signal unknown",
    noise_short: "N",
    signal_short: "S"
  },
  list: {
    title: "Aircraft heard",
    title_short: "Aircraft",
    name_type: "Callsign \xB7 type",
    altitude: "Altitude",
    signal: "Signal",
    located: "Position known",
    not_located: "No position",
    ground: "on the ground",
    now: "now",
    seconds: "{value} s",
    minutes: "{value} min",
    speed: "{value} km/h",
    empty: "No aircraft heard in the last minute",
    failed: "The aircraft couldn't be read"
  },
  feeders: {
    title: "Feeders",
    problem: "A feeder has a problem"
  },
  editor: {
    device: "Receiver",
    name: "Name",
    name_helper: "Replaces the receiver's name",
    layout: "Layout",
    layout_full: "Full",
    layout_compact: "Compact, one row",
    row_step: "Rounding in a sections view",
    row_step_helper: "With automatic row height, the card's height is rounded up to whole rows, or to half rows to save space.",
    row_step_full: "Whole rows",
    row_step_half: "Half rows",
    feeders: "Feeders",
    feeders_helper: "Other feeders' status, such as Flightradar24's, as rows on a tab of their own. Shown in the full layout.",
    feeder_entity: "Status",
    feeder_entity_helper: "Whether the feeder is up",
    feeder_name: "Name",
    feeder_name_helper: "Replaces the entity's name",
    feeder_detail: "Detail",
    feeder_detail_helper: "Shown after the status, such as the aircraft the feeder reports"
  }
};

// src/localize/languages/fi.json
var fi_default = {
  common: {
    name: "ADS-B-vastaanotin",
    description: "ADS-B-vastaanottimen tila ADS-B Live -integraatiosta",
    invalid_configuration: "Virheellinen konfiguraatio. Valitse vastaanotin.",
    invalid_height: "Virheellinen korkeus. Korkeuksien (height ja max_height) on oltava positiivisia lukuja pikselein\xE4, ja korkeustilan (height_mode) auto, fixed tai max.",
    invalid_row_step: "Virheellinen py\xF6ristys. Py\xF6ristyksen (row_step) on oltava full tai half.",
    no_receiver: "Vastaanotinta ei l\xF6ydy",
    no_entity: "Entiteetti\xE4 {entity} ei l\xF6ydy"
  },
  status: {
    receiving: "Kuulee",
    quiet: "Hiljaista",
    unavailable: "Ei saatavilla"
  },
  rates: {
    messages: "{value} viesti\xE4/s",
    positions: "{value} sijaintia/min",
    positions_one: "{value} sijainti/min"
  },
  figures: {
    tracked: "seurannassa",
    with_position: "sijainnilla",
    range: "kantama, {minutes}\xA0min"
  },
  curve: {
    past: "{hours} h sitten",
    now: "nyt",
    peak: "huippu {value}",
    point: "klo {time} \xB7 keskim\xE4\xE4rin {value} seurannassa",
    point_now: "nyt \xB7 {value} seurannassa"
  },
  meter: {
    signal: "Signaali",
    noise: "Kohina",
    signal_unknown: "Signaali ei tiedossa",
    noise_short: "K",
    signal_short: "S"
  },
  list: {
    title: "Kuultavat koneet",
    title_short: "Koneet",
    name_type: "Tunnus \xB7 tyyppi",
    altitude: "Korkeus",
    signal: "Signaali",
    located: "Sijainti tiedossa",
    not_located: "Ei sijaintia",
    ground: "maassa",
    now: "nyt",
    seconds: "{value} s",
    minutes: "{value} min",
    speed: "{value} km/h",
    empty: "Viimeisen minuutin aikana ei ole kuultu koneita",
    failed: "Koneita ei saatu luettua"
  },
  feeders: {
    title: "Sy\xF6tteet",
    problem: "Sy\xF6tteess\xE4 on ongelma"
  },
  editor: {
    device: "Vastaanotin",
    name: "Nimi",
    name_helper: "Korvaa vastaanottimen nimen",
    layout: "Asettelu",
    layout_full: "T\xE4ysi",
    layout_compact: "Tiivis, yksi rivi",
    row_step: "Py\xF6ristys osioihin jaetussa n\xE4kym\xE4ss\xE4",
    row_step_helper: "Automaattisella rivikorkeudella kortin korkeus py\xF6ristet\xE4\xE4n yl\xF6sp\xE4in kokonaisiin riveihin, tai tilan s\xE4\xE4st\xE4miseksi puolikkaisiin riveihin.",
    row_step_full: "Kokonaisiin riveihin",
    row_step_half: "Puolikkaisiin riveihin",
    feeders: "Sy\xF6tteet",
    feeders_helper: "Muiden sy\xF6tt\xE4jien, esimerkiksi Flightradar24:n, tila rivein\xE4 omalla v\xE4lilehdell\xE4\xE4n. N\xE4kyy t\xE4ydess\xE4 asettelussa.",
    feeder_entity: "Tila",
    feeder_entity_helper: "Onko sy\xF6tt\xE4j\xE4 toiminnassa",
    feeder_name: "Nimi",
    feeder_name_helper: "Korvaa entiteetin nimen",
    feeder_detail: "Lis\xE4tieto",
    feeder_detail_helper: "N\xE4ytet\xE4\xE4n tilan per\xE4ss\xE4, esimerkiksi sy\xF6tt\xE4j\xE4n raportoimat koneet"
  }
};

// src/localize/localize.ts
var FILES = { "./languages/en.json": en_default, "./languages/fi.json": fi_default };
var LANGUAGES = Object.fromEntries(
  Object.entries(FILES).map(([path, table]) => [path.replace(/^.*\/|\.json$/g, "").toLowerCase(), table])
);
var LANGUAGE_CODES = Object.keys(LANGUAGES).sort();
function translate(language, key) {
  const code = (language ?? "en").split(/[-_]/)[0].toLowerCase();
  return read(LANGUAGES[code], key) ?? read(LANGUAGES.en, key) ?? key;
}
function read(table, key) {
  let value = table;
  for (const part of key.split(".")) {
    if (value === null || typeof value !== "object") {
      return void 0;
    }
    value = value[part];
  }
  return typeof value === "string" ? value : void 0;
}
function browserLanguage() {
  return document.documentElement.lang || navigator.language || "en";
}

// src/height.ts
var HEIGHT_MODES = ["auto", "fixed", "max"];
var pixels = (value) => value == null || typeof value === "number" && Number.isFinite(value) && value > 0;
function validHeight(config) {
  return (config.height_mode == null || HEIGHT_MODES.includes(config.height_mode)) && pixels(config.height) && pixels(config.max_height);
}
function heightMode(config) {
  return config.height_mode ?? (config.height ? "fixed" : config.max_height ? "max" : "auto");
}
var ROW_HEIGHT = 56;
var ROW_GAP = 8;
function heightStyle(config, layout, minimum = 0) {
  const rows = config.grid_options ? config.grid_options.rows : config.layout_options?.grid_rows;
  if (layout === "grid" && typeof rows === "number") {
    return "height: 100%";
  }
  const mode = heightMode(config);
  if (mode === "fixed" && config.height) {
    return `height: ${Math.max(config.height, minimum)}px`;
  }
  return mode === "max" && config.max_height ? `max-height: ${Math.max(config.max_height, minimum)}px` : "";
}
function gridMinRows(minimum) {
  return Math.max(1, Math.ceil((minimum + ROW_GAP) / (ROW_HEIGHT + ROW_GAP)));
}
function heightCardSize(config, content, minimum = 0) {
  const mode = heightMode(config);
  if (mode === "fixed" && config.height) {
    return Math.max(1, Math.round(Math.max(config.height, minimum) / 50));
  }
  return mode === "max" && config.max_height ? Math.max(1, Math.min(content, Math.round(Math.max(config.max_height, minimum) / 50))) : content;
}

// src/rows.ts
var ROW_STEPS = ["full", "half"];
var ROW_PX = 64;
var ROW_GAP_PX = 8;
function validRowStep(config) {
  return config.row_step === void 0 || config.row_step === null || ROW_STEPS.includes(config.row_step);
}
var step = (config) => config.row_step === "half" ? ROW_PX / 2 : ROW_PX;
function filledHeight(content, config, limit = Infinity) {
  return Math.min(Math.max(1, Math.ceil((content + ROW_GAP_PX) / step(config))) * step(config) - ROW_GAP_PX, limit);
}
function fillLimit(config, layout, minimum = 0) {
  const rows = config.grid_options ? config.grid_options.rows : config.layout_options?.grid_rows;
  if (layout !== "grid" || typeof rows === "number") {
    return 0;
  }
  const mode = heightMode(config);
  if (mode === "fixed" && config.height) {
    return 0;
  }
  if (mode !== "max" || !config.max_height) {
    return Infinity;
  }
  const down = Math.floor((config.max_height + ROW_GAP_PX) / step(config)) * step(config) - ROW_GAP_PX;
  return Math.max(down, filledHeight(minimum, config));
}
function filledStyle(config, layout, minimum, filled) {
  const limit = fillLimit(config, layout, minimum);
  if (!limit) {
    return heightStyle(config, layout, minimum);
  }
  return [limit < Infinity && `max-height: ${limit}px`, filled && `min-height: ${filled}px`].filter(Boolean).join("; ");
}
function rowStepSchema(config, text) {
  if (heightMode(config) === "fixed" && config.height) {
    return [];
  }
  return [
    {
      name: "row_step",
      selector: {
        select: { mode: "dropdown", options: ROW_STEPS.map((value) => ({ value, label: text(`editor.row_step_${value}`) })) }
      }
    }
  ];
}
function rowStepData(config) {
  return { ...config, row_step: config.row_step ?? "full" };
}
function tidyRowStep(config) {
  const tidied = { ...config };
  if (tidied.row_step !== "half" || heightMode(tidied) === "fixed" && tidied.height) {
    delete tidied.row_step;
  }
  return tidied;
}

// src/editor.ts
function receiverSchema(config, text) {
  return [
    {
      name: "device",
      required: true,
      selector: { device: { filter: { integration: PLATFORM, manufacturer: RECEIVER_MANUFACTURER } } }
    },
    { name: "name", selector: { text: {} } },
    {
      name: "layout",
      selector: {
        select: {
          mode: "list",
          options: [
            { value: "full", label: text("editor.layout_full") },
            { value: "compact", label: text("editor.layout_compact") }
          ]
        }
      }
    },
    // The height mode is set in YAML only. The compact layout has none, and so always offers its row step.
    ...rowStepSchema(compact(config) ? withoutHeight(config) : config, text)
  ];
}
function compact(config) {
  return config.layout === "compact";
}
function withoutHeight(config) {
  const rest = { ...config };
  delete rest.height_mode;
  delete rest.height;
  delete rest.max_height;
  return rest;
}
function feedersSchema(text) {
  return [
    {
      name: "feeders",
      selector: {
        object: {
          multiple: true,
          label_field: "entity",
          fields: {
            entity: {
              label: text("editor.feeder_entity"),
              description: text("editor.feeder_entity_helper"),
              required: true,
              selector: { entity: {} }
            },
            name: { label: text("editor.feeder_name"), description: text("editor.feeder_name_helper"), selector: { text: {} } },
            detail: {
              label: text("editor.feeder_detail"),
              description: text("editor.feeder_detail_helper"),
              selector: { entity: {} }
            }
          }
        }
      }
    }
  ];
}
function compactFeeders(feeders) {
  return (feeders ?? []).filter((feeder) => !!feeder?.entity).map((feeder) => {
    const entry = { entity: feeder.entity };
    if (feeder.name) {
      entry.name = feeder.name;
    }
    if (feeder.detail) {
      entry.detail = feeder.detail;
    }
    return entry;
  });
}
var AdsbReceiverCardEditor = class extends i4 {
  setConfig(config) {
    this.config = config;
  }
  render() {
    if (!this.hass || !this.config) {
      return A;
    }
    const data = { layout: "full", ...rowStepData(compact(this.config) ? withoutHeight(this.config) : this.config) };
    return b2`
            <ha-form
                .hass=${this.hass}
                .data=${data}
                .schema=${receiverSchema(this.config, (key) => this.text(key))}
                .computeLabel=${(entry) => this.text(`editor.${entry.name}`)}
                .computeHelper=${(entry) => this.helper(entry.name)}
                @value-changed=${this.valueChanged}
            ></ha-form>
            <p class="helper">${this.text("editor.feeders_helper")}</p>
            <ha-form
                .hass=${this.hass}
                .data=${data}
                .schema=${feedersSchema((key) => this.text(key))}
                .computeLabel=${(entry) => this.text(`editor.${entry.name}`)}
                @value-changed=${this.valueChanged}
            ></ha-form>
        `;
  }
  static get styles() {
    return i`
            .helper {
                margin: 16px 0 8px;
                padding: 0 16px;
                font-size: 12px;
                line-height: 1.4;
                color: var(--secondary-text-color);
            }
        `;
  }
  valueChanged(event) {
    const value = compact(event.detail.value) ? withoutHeight(event.detail.value) : event.detail.value;
    const config = tidyRowStep(value);
    const feeders = compactFeeders(config.feeders);
    if (feeders.length) {
      config.feeders = feeders;
    } else {
      delete config.feeders;
    }
    if (!config.name) {
      delete config.name;
    }
    delete config.list_open;
    if (!config.layout || config.layout === "full") {
      delete config.layout;
    }
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
  text(key) {
    return translate(this.language(), key);
  }
  helper(name) {
    const key = `editor.${name}_helper`;
    const helper = translate(this.language(), key);
    return helper === key ? void 0 : helper;
  }
  language() {
    return this.hass?.locale?.language ?? this.hass?.language ?? browserLanguage();
  }
};
__decorateClass([
  n4({ attribute: false })
], AdsbReceiverCardEditor.prototype, "hass", 2);
__decorateClass([
  r5()
], AdsbReceiverCardEditor.prototype, "config", 2);
if (!customElements.get("adsb-receiver-card-editor")) {
  customElements.define("adsb-receiver-card-editor", AdsbReceiverCardEditor);
}

// src/fade.ts
var fadeStyles = i`
    .fades {
        --fade-length: min(24px, 25%);
        scroll-padding-block: calc(var(--fade-top-offset, 0px) + var(--fade-length, 24px)) var(--fade-length, 24px);
    }

    .fade-top {
        mask-image: linear-gradient(
            to bottom,
            #000 var(--fade-top-offset, 0px),
            transparent var(--fade-top-offset, 0px),
            #000 calc(var(--fade-top-offset, 0px) + var(--fade-length, 24px))
        );
    }

    .fade-bottom {
        mask-image: linear-gradient(to top, transparent, #000 var(--fade-length, 24px));
    }

    .fade-top.fade-bottom {
        mask-image: linear-gradient(
            to bottom,
            #000 var(--fade-top-offset, 0px),
            transparent var(--fade-top-offset, 0px),
            #000 calc(var(--fade-top-offset, 0px) + var(--fade-length, 24px)),
            #000 calc(100% - var(--fade-length, 24px)),
            transparent
        );
    }
`;
function markFade(part) {
  const hidden = part.scrollHeight - part.clientHeight;
  part.classList.toggle("fade-top", hidden > 1 && part.scrollTop > 1);
  part.classList.toggle("fade-bottom", hidden > 1 && hidden - part.scrollTop > 1);
}
var onScroll = (event) => markFade(event.currentTarget);
var ScrollFade = class {
  constructor(host, parts) {
    this.host = host;
    this.parts = parts;
    /** Each followed part with the children whose size it watches. */
    this.followed = /* @__PURE__ */ new Map();
    this.resized = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const part = this.followed.has(target) ? target : target.parentElement;
        if (part && this.followed.has(part)) {
          markFade(part);
        }
      }
    });
    host.addController(this);
  }
  hostConnected() {
    if (this.host.hasUpdated) {
      this.follow();
    }
  }
  hostUpdated() {
    if (this.host.isConnected) {
      this.follow();
    }
  }
  hostDisconnected() {
    for (const part of [...this.followed.keys()]) {
      this.forget(part);
    }
  }
  follow() {
    const now = new Set(this.parts());
    for (const part of [...this.followed.keys()]) {
      if (!now.has(part)) {
        this.forget(part);
      }
    }
    for (const part of now) {
      if (!this.followed.has(part)) {
        part.addEventListener("scroll", onScroll, { passive: true });
        this.resized?.observe(part);
      }
      part.classList.add("fades");
      const before = this.followed.get(part) ?? [];
      const children = [...part.children];
      before.filter((child) => !children.includes(child)).forEach((child) => this.resized?.unobserve(child));
      children.filter((child) => !before.includes(child)).forEach((child) => this.resized?.observe(child));
      this.followed.set(part, children);
      markFade(part);
    }
  }
  forget(part) {
    this.followed.get(part)?.forEach((child) => this.resized?.unobserve(child));
    this.followed.delete(part);
    part.removeEventListener("scroll", onScroll);
    this.resized?.unobserve(part);
    part.classList.remove("fades", "fade-top", "fade-bottom");
  }
};

// src/history.ts
async function fetchStatistics(hass, id, start, now) {
  if (!hass.callWS) {
    return [];
  }
  const answer = await hass.callWS({
    type: "recorder/statistics_during_period",
    start_time: new Date(start).toISOString(),
    end_time: new Date(now).toISOString(),
    statistic_ids: [id],
    period: "hour",
    types: ["mean", "max"]
  });
  return answer?.[id] ?? [];
}

// src/receiver.ts
function receiverDevices(hass) {
  const devices = Object.values(hass.entities ?? {}).filter((entry) => entry?.platform === PLATFORM && entry.translation_key === "messages_per_second" && entry.device_id).map((entry) => entry?.device_id).filter((device) => hass.devices?.[device]?.manufacturer === RECEIVER_MANUFACTURER);
  return [...new Set(devices)];
}
function receiverSensors(hass, device) {
  const found = {};
  for (const entry of Object.values(hass.entities ?? {})) {
    const key = entry?.translation_key;
    if (entry && entry.device_id === device && entry.platform === PLATFORM && key && SENSORS.includes(key)) {
      found[key] = entry.entity_id;
    }
  }
  return found;
}
function receiverName(hass, config) {
  const device = hass.devices?.[config.device];
  return config.name || device?.name_by_user || device?.name || config.device;
}
function valueOf(hass, entityId) {
  const state = entityId ? hass.states[entityId]?.state : void 0;
  const value = state === void 0 ? Number.NaN : Number.parseFloat(state);
  return Number.isFinite(value) ? value : null;
}
function receiverStatus(hass, sensors) {
  const positions = sensors.positions_per_minute ? hass.states[sensors.positions_per_minute] : void 0;
  if (!positions || positions.state === "unavailable") {
    return "unavailable";
  }
  return (valueOf(hass, sensors.positions_per_minute) ?? 0) > 0 ? "receiving" : "quiet";
}
function numberLocale(format) {
  switch (format.number_format) {
    case "comma_decimal":
      return ["en-US", "en"];
    case "decimal_comma":
      return ["de", "es", "it"];
    case "space_comma":
      return ["fr", "sv", "cs"];
    case "quote_decimal":
      return ["de-CH"];
    case "none":
      return "en-US";
    case "system":
      return void 0;
    default:
      return format.language;
  }
}
function formatNumber(value, format, precision) {
  return new Intl.NumberFormat(numberLocale(format), {
    ...precision === void 0 ? {} : { minimumFractionDigits: precision, maximumFractionDigits: precision },
    ...format.number_format === "none" ? { useGrouping: false } : {}
  }).format(value);
}
function meter(signal, noise) {
  if (noise === null) {
    return null;
  }
  return { noise: meterPlace(noise), signal: signal === null ? null : meterPlace(signal) };
}
function meterPlace(level) {
  return (Math.min(Math.max(level, METER_MIN_DBFS), METER_MAX_DBFS) - METER_MIN_DBFS) / (METER_MAX_DBFS - METER_MIN_DBFS) * 100;
}
var UP = ["on", "connected", "online", "ok", "home"];
var DOWN = ["off", "disconnected", "offline", "not_home"];
function feederState(entity) {
  if (!entity) {
    return "unknown";
  }
  const state = entity.state.toLowerCase();
  const inverted = entity.entity_id.startsWith("binary_sensor.") && entity.attributes.device_class === "problem";
  if (UP.includes(state)) {
    return inverted ? "error" : "ok";
  }
  if (DOWN.includes(state)) {
    return inverted ? "ok" : "error";
  }
  return "unknown";
}
var HALF_HOUR = 30 * 6e4;
function curvePoints(rows, start, now, current) {
  const points = rows.filter((row) => typeof row.mean === "number" && row.start + HALF_HOUR >= start && row.start <= now).map((row) => ({ time: Math.min(row.start + HALF_HOUR, now), value: row.mean })).sort((one, other) => one.time - other.time);
  if (current !== null) {
    points.push({ time: now, value: current });
  }
  return points;
}
function peakOf(rows, start, current) {
  const maximums = rows.filter((row) => row.start + 2 * HALF_HOUR > start).map((row) => row.max ?? row.mean ?? 0);
  return Math.max(0, current ?? 0, ...maximums);
}
function linePath(points, start, end, width, height, max) {
  if (!points.length || end <= start) {
    return "";
  }
  const x2 = (time) => (Math.min(Math.max(time, start), end) - start) / (end - start) * width;
  const y3 = (value) => 1 + (1 - Math.min(Math.max(value, 0), max) / max) * (height - 2);
  const drawn = points.length === 1 ? [points[0], points[0]] : points;
  return drawn.map((point, index) => `${index ? "L" : "M"}${x2(point.time).toFixed(1)},${y3(point.value).toFixed(1)}`).join("");
}

// src/adsb-receiver-card.ts
var HOUR = 36e5;
var CURVE = { width: 360, height: 36 };
var SMALL_CURVE = { width: 90, height: 32 };
var TABS_PX = 32;
var LEAST_PX = [
  [160, 376],
  [0, 383]
];
var px = (value) => parseFloat(value) || 0;
var AdsbReceiverCard = class extends i4 {
  constructor() {
    super();
    this.history = [];
    this.historyLoaded = false;
    this.aircraftFailed = false;
    this.clock = Date.now();
    this.aircraftReadAt = 0;
    this.aircraftReading = false;
    this.width = 0;
    this.filled = 0;
    this.spare = 0;
    this.resizes = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(() => this.measureSoon());
    /**
     * Has a held card's top fade start under the list's column heads while they are stuck at the top of the pane, rather
     * than fade them. Stuck, the heads' top is at the pane's, or above it once the list's end pushes them up.
     */
    this.placeTopFade = () => {
      const pane = this.renderRoot.querySelector("ha-card > .pane");
      if (!pane) {
        return;
      }
      const head = pane.closest("ha-card.held") ? pane.querySelector(".plane-head")?.getBoundingClientRect() : void 0;
      const top = pane.getBoundingClientRect().top;
      const covered = head && head.top <= top + 0.5 ? Math.max(0, head.bottom - top) : 0;
      if (covered > 0) {
        pane.style.setProperty("--fade-top-offset", `${covered}px`);
      } else {
        pane.style.removeProperty("--fade-top-offset");
      }
    };
    new ScrollFade(this, () => this.heightStyle() ? this.renderRoot.querySelectorAll("ha-card > .pane") : []);
  }
  static getConfigElement() {
    return document.createElement("adsb-receiver-card-editor");
  }
  /** Offers the first receiver there is when the card is added from the picker. */
  static getStubConfig(hass) {
    return { device: hass ? receiverDevices(hass)[0] ?? "" : "" };
  }
  setConfig(config) {
    if (!config || typeof config.device !== "string" || !config.device) {
      throw new Error(translate(browserLanguage(), "common.invalid_configuration"));
    }
    if (!validHeight(config)) {
      throw new Error(translate(browserLanguage(), "common.invalid_height"));
    }
    if (!validRowStep(config)) {
      throw new Error(translate(browserLanguage(), "common.invalid_row_step"));
    }
    if (this.config && this.config.device !== config.device) {
      this.aircraft = void 0;
      this.aircraftFailed = false;
      this.aircraftOf = config.device;
      this.aircraftReadAt = 0;
    }
    this.config = { ...config, feeders: Array.isArray(config.feeders) ? config.feeders.filter((feeder) => !!feeder?.entity) : [] };
  }
  getCardSize() {
    return this.compact() ? 1 : heightCardSize(this.config ?? {}, 6 + Math.max(4, this.config?.feeders?.length ?? 0), this.minimumHeight());
  }
  /**
   * In a sections view the card takes a whole section by default. Below 9 columns, 214 px on a phone, its texts have too
   * little room. Held, the compact layout is one row at any width.
   */
  getGridOptions() {
    return { columns: 12, min_columns: 9, rows: "auto", min_rows: this.compact() ? 1 : gridMinRows(this.minimumHeight()) };
  }
  /** The curve is read when the card comes on the page and every few minutes while it stays there. */
  connectedCallback() {
    super.connectedCallback();
    this.timer = setInterval(() => void this.loadHistory(true), HISTORY_REFRESH_MS);
    void this.loadHistory(true);
    if (this.shownPane() === "aircraft") {
      this.clock = Date.now();
    }
    this.followPane();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.timer);
    this.stopList();
    this.resizes?.disconnect();
    cancelAnimationFrame(this.frame ?? 0);
    this.hover = void 0;
  }
  shouldUpdate(changed) {
    const previous = changed.get("hass");
    if (!this.config || !this.hass || changed.size > 1 || !changed.has("hass") || !previous) {
      return true;
    }
    if (previous.entities !== this.hass.entities || previous.devices !== this.hass.devices || previous.locale !== this.hass.locale || previous.language !== this.hass.language || previous.services !== this.hass.services || previous.formatEntityState !== this.hass.formatEntityState) {
      return true;
    }
    return this.watched().some((id) => previous.states[id] !== this.hass?.states[id]);
  }
  /** A redraw while the aircraft are shown shows their ages as they are now, also the first one after they come back. */
  willUpdate() {
    if (this.shownPane() === "aircraft") {
      this.clock = Date.now();
    }
    if (this.hover && !this.curveShown()) {
      this.hover = void 0;
    }
  }
  /** Whether the full layout draws its curve: a receiver that isn't unavailable, with its aircraft tracked sensor. */
  curveShown() {
    const hass = this.hass;
    if (!hass || !this.config || this.compact() || !hass.devices?.[this.config.device]) {
      return false;
    }
    const sensors = receiverSensors(hass, this.config.device);
    return !!sensors.aircraft_tracked && receiverStatus(hass, sensors) !== "unavailable";
  }
  updated() {
    void this.loadHistory(false);
    this.followPane();
    this.placeTopFade();
    if (!this.isConnected) {
      return;
    }
    const card = this.renderRoot.querySelector("ha-card");
    if (card) {
      this.resizes?.observe(card);
    }
    this.measureSoon();
  }
  measureSoon() {
    cancelAnimationFrame(this.frame ?? 0);
    this.frame = requestAnimationFrame(() => this.fillRows());
  }
  /**
   * In a sections view whose rows are left automatic, the card takes the whole rows its content needs, or the half rows
   * with `row_step: half`, so the cards under it stay on the rows, up to the limit of a card that grows up to one. The
   * room left over goes under the top, in the compact
   * layout around its row. Held to a height, the room the pane doesn't need stays at its bottom, so the fixed part
   * doesn't move when the other tab is picked.
   */
  fillRows() {
    const card = this.renderRoot.querySelector("ha-card");
    if (!card || !card.clientWidth) {
      return;
    }
    const width = Math.round(card.getBoundingClientRect().width);
    if (width !== this.width) {
      this.width = width;
    }
    const limit = fillLimit(this.sizing(), this.layout, this.minimumHeight());
    if (!limit || card.classList.contains("message")) {
      if (this.filled) this.filled = 0;
      if (this.spare) this.spare = 0;
      return;
    }
    const parts = card.querySelectorAll(
      ":scope > .top, :scope > .figures, :scope > .curve, :scope > .meter, :scope > .tabs, :scope > .pane, :scope > .row"
    );
    const last = parts[parts.length - 1];
    if (!last) {
      return;
    }
    const style = getComputedStyle(card);
    let content = last.getBoundingClientRect().bottom + px(getComputedStyle(last).marginBottom) - card.getBoundingClientRect().top + px(style.paddingBottom) + px(style.borderBottomWidth);
    const top = card.querySelector(":scope > .top");
    content -= top ? px(getComputedStyle(top).paddingBottom) : 0;
    const filled = filledHeight(Math.round(content), this.sizing(), limit);
    const spare = Math.max(0, Math.floor(filled - content));
    if (filled !== this.filled) {
      this.filled = filled;
    }
    if (spare !== this.spare) {
      this.spare = spare;
    }
  }
  /** The card's inline style: the height it is held to, or the rows it fills up to any limit, with their spare room under the top. */
  cardStyle() {
    const style = filledStyle(this.sizing(), this.layout, this.minimumHeight(), this.filled);
    return this.filled ? `${style}; --spare: ${this.spare}px` : style;
  }
  watched() {
    if (!this.hass || !this.config) {
      return [];
    }
    const feeders = (this.config.feeders ?? []).flatMap((feeder) => [feeder.entity, feeder.detail ?? ""]);
    return [...Object.values(receiverSensors(this.hass, this.config.device)), ...feeders].filter((id) => !!id);
  }
  /** Reads the curve again when `again`, otherwise only when its sensor has changed since the last read. */
  async loadHistory(again) {
    const hass = this.hass;
    const id = hass && this.config ? receiverSensors(hass, this.config.device).aircraft_tracked : void 0;
    if (!hass || !id || !again && this.historyOf === id) {
      return;
    }
    if (this.historyOf !== id) {
      this.history = [];
      this.historyLoaded = false;
      this.historyOf = id;
    }
    const now = Date.now();
    try {
      const rows = await fetchStatistics(hass, id, now - HISTORY_HOURS * HOUR, now);
      if (this.historyOf === id) {
        this.history = rows;
        this.historyLoaded = true;
      }
    } catch (error) {
      console.warn("adsb-receiver-card: could not read the history of", id, error);
    }
  }
  render() {
    if (!this.hass || !this.config) {
      return A;
    }
    const sensors = receiverSensors(this.hass, this.config.device);
    if (!this.hass.devices?.[this.config.device] || !Object.keys(sensors).length) {
      return b2`<ha-card class="message" style=${this.heightStyle()}>${this.text("common.no_receiver")}</ha-card>`;
    }
    const status = receiverStatus(this.hass, sensors);
    return this.compact() ? this.compactCard(sensors, status) : this.fullCard(sensors, status);
  }
  /**
   * The full layout: a fixed part with the receiver, its figures, the curve and the meter, and under it a pane with the
   * aircraft heard or the other feeders, under tabs when it has both (see `shownPane`). Held to a height, only the pane
   * scrolls.
   */
  fullCard(sensors, status) {
    const device = this.hass?.devices?.[this.config?.device ?? ""];
    const version = device?.sw_version ? [device.manufacturer, device.sw_version].filter(Boolean).join(" ") : "";
    const available = status !== "unavailable";
    const name = receiverName(this.hass, this.config);
    const statusText = this.text(`status.${status}`);
    const line = available ? [statusText, ...this.rates(sensors)] : [statusText];
    const pane = this.shownPane();
    return b2`
            <ha-card class="full ${status} ${this.held() ? "held" : ""} ${this.filled ? "filled" : ""}" style=${this.cardStyle()}>
                <div class="top">
                    ${this.icon()}
                    <div class="who">
                        <div class="first">
                            <span class="name" title=${name}>${name}</span>
                            ${version ? b2`<span class="version" title=${version}>${version}</span>` : A}
                        </div>
                        <div class="line" title=${line.join(" \xB7 ")}>
                            <span class="status">${statusText}</span>${line.slice(1).map((part) => b2` · ${part}`)}
                        </div>
                    </div>
                </div>
                ${available ? b2`
                              <div class="figures">
                                  ${this.figure(sensors.aircraft_tracked, "figures.tracked")}
                                  ${this.figure(sensors.aircraft_with_position, "figures.with_position")}
                                  ${this.figure(sensors.max_range, "figures.range", true, { minutes: formatNumber(RANGE_MINUTES, this.numberFormat(), 0) })}
                              </div>
                              ${this.curve(sensors)} ${this.meter(sensors)}
                          ` : A}
                ${pane ? b2`${this.panes().length > 1 ? this.tabs(sensors) : A}
                              <div class="pane ${this.panes().length > 1 ? "" : "alone"}" @scroll=${this.placeTopFade}>
                                  ${pane === "aircraft" ? this.planes() : this.feeders()}
                              </div>` : A}
            </ha-card>
        `;
  }
  compactCard(sensors, status) {
    const available = status !== "unavailable";
    const line = [
      `${this.number(sensors.aircraft_tracked)} ${this.text("figures.tracked")}`,
      `${this.number(sensors.aircraft_with_position)} ${this.text("figures.with_position")}`,
      this.rates(sensors)[0]
    ];
    const name = receiverName(this.hass, this.config);
    const statusText = this.text(`status.${status}`);
    return b2`
            <ha-card class="compact ${status} ${this.held() ? "held" : ""}" style=${this.cardStyle()}>
                <button class="row" @click=${() => this.moreInfo(sensors.aircraft_tracked ?? sensors.positions_per_minute)}>
                    ${this.icon()}
                    <div class="who">
                        <div class="name" title="${name} ${statusText}">${name} <span class="status">${statusText}</span></div>
                        ${available ? b2`<div class="line" title=${line.join(", ")}>${this.pieces(line)}</div>` : A}
                    </div>
                    ${available ? this.smallCurve(sensors) : A}
                </button>
            </ha-card>
        `;
  }
  /** The panes the card has: the aircraft with ADS-B Live's action while the receiver is available, the feeders when set. */
  panes() {
    return [...this.listShown() ? ["aircraft"] : [], ...this.config?.feeders?.length ? ["feeders"] : []];
  }
  /**
   * The pane shown: the one picked from its tab, or else the feeders while one of them has a problem, and the aircraft
   * otherwise.
   */
  shownPane() {
    const panes = this.panes();
    if (this.picked && panes.includes(this.picked)) {
      return this.picked;
    }
    return panes.includes("feeders") && this.feederProblem() ? "feeders" : panes[0];
  }
  /** Whether a feeder is down, unavailable or missing. A state that says neither up nor down is no problem. */
  feederProblem() {
    return (this.config?.feeders ?? []).some((feeder) => {
      const entity = this.hass?.states[feeder.entity];
      return !entity || entity.state === "unavailable" || feederState(entity) === "error";
    });
  }
  tabs(sensors) {
    const shown = this.shownPane();
    const tab = (pane, label, count, problem = false) => b2`
            <button
                class="tab ${shown === pane ? "on" : ""}"
                role="tab"
                aria-selected=${shown === pane ? "true" : "false"}
                @click=${() => this.picked = pane}
            >
                ${label}<span class="count">${count}</span>${problem ? b2`<span
                              class="problem"
                              role="img"
                              aria-label=${this.text("feeders.problem")}
                              title=${this.text("feeders.problem")}
                          ></span>` : A}
            </button>
        `;
    const title = this.text("list.title");
    return b2`
            <div class="tabs" role="tablist">
                ${this.panes().map(
      (pane) => pane === "aircraft" ? tab(
        pane,
        b2`<span class="label long" title=${title}>${title}</span
                                  ><span class="label short" title=${title}>${this.text("list.title_short")}</span>`,
        this.aircraftCount(sensors)
      ) : tab(
        pane,
        b2`<span class="label" title=${this.text("feeders.title")}>${this.text("feeders.title")}</span>`,
        formatNumber(this.config?.feeders?.length ?? 0, this.numberFormat(), 0),
        this.feederProblem()
      )
    )}
            </div>
        `;
  }
  /**
   * The aircraft's count: the rows of the list while it is shown and read, so the tab never disagrees with the rows under
   * it, and the aircraft tracked otherwise, as the list isn't read then.
   */
  aircraftCount(sensors) {
    return this.shownPane() === "aircraft" && this.aircraft ? formatNumber(this.aircraft.aircraft.length, this.numberFormat(), 0) : this.number(sensors.aircraft_tracked);
  }
  feeders() {
    return b2`${(this.config?.feeders ?? []).map((feeder) => this.feeder(feeder))}`;
  }
  /** Whether the aircraft can be on the card: the full layout of a receiver that isn't unavailable, with ADS-B Live's action. */
  listShown() {
    const hass = this.hass;
    if (!hass || !this.config || this.compact() || !hasReceiverAircraft(hass) || !hass.devices?.[this.config.device]) {
      return false;
    }
    const sensors = receiverSensors(hass, this.config.device);
    return Object.keys(sensors).length > 0 && receiverStatus(hass, sensors) !== "unavailable";
  }
  planes() {
    if (!this.aircraft) {
      return this.aircraftFailed ? b2`<div class="message" title=${this.text("list.failed")}>${this.text("list.failed")}</div>` : A;
    }
    if (!this.aircraft.aircraft.length) {
      return b2`<div class="message" title=${this.text("list.empty")}>${this.text("list.empty")}</div>`;
    }
    const unit = this.aircraft.altitude_unit;
    return b2`
            <div class="planes">
                <div class="plane-head">
                    ${["list.name_type", "list.altitude", "list.signal"].map((key) => b2`<span title=${this.text(key)}>${this.text(key)}</span>`)}
                </div>
                ${byHeard(this.aircraft.aircraft).map((plane) => this.plane(plane, unit))}
            </div>
        `;
  }
  plane(plane, unit) {
    const format = this.numberFormat();
    const altitude = plane.on_ground ? this.text("list.ground") : plane.altitude === void 0 ? "\u2013" : `${formatNumber(plane.altitude, format, 0)} ${unit}`;
    const position = this.text(plane.position ? "list.located" : "list.not_located");
    const ago = heardAgo(plane.heard, this.clock);
    const sub = [
      plane.speed_kmh === void 0 ? "" : this.text("list.speed", { value: formatNumber(plane.speed_kmh, format, 0) }),
      ago ? this.text(`list.${ago.unit}`, { value: formatNumber(ago.value, format, 0) }) : ""
    ].filter(Boolean);
    return b2`
            <div class="plane ${plane.position ? "" : "nopos"}">
                <span class="id" title=${[plane.name, plane.type].filter(Boolean).join(" ")}
                    ><span class="callsign">${plane.name}</span
                    >${plane.type ? b2` <span class="type">${plane.type}</span>` : A}<ha-icon
                        class="position"
                        icon=${plane.position ? "mdi:crosshairs-gps" : "mdi:crosshairs-question"}
                        role="img"
                        aria-label=${position}
                        title=${position}
                    ></ha-icon
                ></span>
                <span class="sub" title=${sub.join(" \xB7 ")}>${sub.join(" \xB7 ")}</span>
                <span class="altitude">${altitude}</span>
                <span class="signal"
                    >${plane.rssi === void 0 ? A : b2`<i style="width: ${Number(meterPlace(plane.rssi).toFixed(1))}%"></i>`}</span
                >
            </div>
        `;
  }
  /** Reads the aircraft while they are shown on a card on the page, and stops when they aren't. */
  followPane() {
    if (this.isConnected && this.shownPane() === "aircraft") {
      if (!this.listTimer) {
        this.startList();
      }
    } else {
      this.stopList();
    }
  }
  /** Reads the list now and every AIRCRAFT_REFRESH_MS, and moves its ages on every second. */
  startList() {
    this.stopList();
    void this.loadAircraft();
    this.listTimer = setInterval(() => {
      this.clock = Date.now();
      if (this.clock - this.aircraftReadAt >= AIRCRAFT_REFRESH_MS) {
        void this.loadAircraft();
      }
    }, 1e3);
  }
  stopList() {
    clearInterval(this.listTimer);
    this.listTimer = void 0;
  }
  async loadAircraft() {
    const hass = this.hass;
    const device = this.config?.device;
    if (!hass || !device || this.aircraftReading || !this.listShown()) {
      return;
    }
    if (this.aircraftOf !== device) {
      this.aircraft = void 0;
      this.aircraftFailed = false;
      this.aircraftOf = device;
    }
    this.aircraftReading = true;
    this.aircraftReadAt = Date.now();
    try {
      const answer = await fetchReceiverAircraft(hass, device);
      if (this.aircraftOf === device) {
        this.aircraft = answer;
        this.aircraftFailed = false;
      }
    } catch (error) {
      console.warn("adsb-receiver-card: could not read the aircraft of", device, error);
      if (this.aircraftOf === device && !this.aircraft) {
        this.aircraftFailed = true;
      }
    } finally {
      this.aircraftReading = false;
    }
  }
  /** The compact layout is held only by a sections view's rows, which it fills with its one row at any width. */
  heightStyle() {
    return heightStyle(this.sizing(), this.layout, this.minimumHeight());
  }
  /** The config's sizing, which in the compact layout leaves out the height mode, as only a sections view's rows hold it. */
  sizing() {
    const config = this.config ?? {};
    return this.compact() ? { grid_options: config.grid_options, layout_options: config.layout_options, row_step: config.row_step } : config;
  }
  held() {
    return this.heightStyle() !== "";
  }
  /**
   * The lowest the full layout is held to, in pixels, at any width the card's 9 columns or more allow, or at its measured
   * width if narrower. The texts above the scroller keep to one line then.
   */
  minimumHeight() {
    if (this.compact()) {
      return 0;
    }
    const width = this.width || Infinity;
    return LEAST_PX.find(([least]) => width >= least)[1] - (this.config?.feeders?.length ? 0 : TABS_PX);
  }
  /** Parts of a sentence, each kept whole, so a number never wraps away from its unit. */
  pieces(parts) {
    return parts.map((part, index) => b2`${index ? ", " : ""}<span class="piece">${part}</span>`);
  }
  icon() {
    return b2`<div class="icon"><ha-icon icon="mdi:radar"></ha-icon></div>`;
  }
  /** Messages per second and positions per minute, as a sentence's parts. */
  rates(sensors) {
    const positions = valueOf(this.hass, sensors.positions_per_minute);
    return [
      this.text("rates.messages", { value: this.number(sensors.messages_per_second) }),
      this.text(positions === 1 ? "rates.positions_one" : "rates.positions", { value: this.number(sensors.positions_per_minute) })
    ];
  }
  figure(entityId, label, withUnit = false, values = {}) {
    const unit = withUnit && entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : void 0;
    const text = this.text(label, values);
    return b2`
            <button class="figure" @click=${() => this.moreInfo(entityId)}>
                <span class="value">${this.number(entityId)}${unit ? b2` <span class="unit">${unit}</span>` : A}</span>
                <span class="label" title=${text}>${text}</span>
            </button>
        `;
  }
  curve(sensors) {
    if (!sensors.aircraft_tracked) {
      return A;
    }
    const { path, peak, lone, points, max, start, now } = this.curvePath(sensors.aircraft_tracked, CURVE);
    const hover = this.hover;
    return b2`
            <button
                class="curve"
                @click=${() => this.moreInfo(sensors.aircraft_tracked)}
                @pointermove=${(event) => this.pointAt(event, points, start, now, max)}
                @pointerleave=${() => this.hover = void 0}
            >
                <span class="plot">
                    <svg viewBox="0 0 ${CURVE.width} ${CURVE.height}" preserveAspectRatio="none" aria-hidden="true">
                        <line class="base" x1="0" x2=${CURVE.width} y1=${CURVE.height - 1} y2=${CURVE.height - 1}></line>
                        <path class=${lone ? "lone" : ""} d=${path}></path>
                    </svg>
                    ${hover ? b2`<span class="dot" style="left: ${hover.x}%; top: ${hover.y}%"></span
                                  ><span class="tip ${hover.x < 25 ? "start" : hover.x > 75 ? "end" : ""}" style="left: ${hover.x}%"
                                      >${hover.text}</span
                                  >` : A}
                </span>
                <span class="caption">
                    <span>${this.text("curve.past", { hours: formatNumber(HISTORY_HOURS, this.numberFormat(), 0) })}</span>
                    <span>${peak > 0 ? this.text("curve.peak", { value: formatNumber(peak, this.numberFormat(), 0) }) : ""}</span>
                    <span>${this.text("curve.now")}</span>
                </span>
            </button>
        `;
  }
  /** The curve's point nearest the pointer, as a dot on the line and a tooltip with its hour and value. */
  pointAt(event, points, start, now, max) {
    const plot = event.currentTarget.querySelector(".plot")?.getBoundingClientRect();
    if (!plot || !plot.width || !points.length || now <= start) {
      return;
    }
    const time = start + Math.min(Math.max((event.clientX - plot.left) / plot.width, 0), 1) * (now - start);
    const point = points.reduce((best, one) => Math.abs(one.time - time) < Math.abs(best.time - time) ? one : best);
    const format = this.numberFormat();
    const value = formatNumber(point.value, format, Number.isInteger(point.value) ? 0 : 1);
    const text = point.time >= now ? this.text("curve.point_now", { value }) : this.text("curve.point", {
      time: new Intl.DateTimeFormat(this.language(), { hour: "numeric", minute: "2-digit" }).format(point.time - HOUR / 2),
      value
    });
    const x2 = Number(((point.time - start) / (now - start) * 100).toFixed(1));
    const y3 = Number(((1 - Math.min(Math.max(point.value, 0), max) / max) * 100).toFixed(1));
    if (this.hover?.x !== x2 || this.hover.text !== text) {
      this.hover = { x: x2, y: y3, text };
    }
  }
  smallCurve(sensors) {
    if (!sensors.aircraft_tracked) {
      return A;
    }
    const { path, lone } = this.curvePath(sensors.aircraft_tracked, SMALL_CURVE);
    return b2`
            <svg class="small-curve" viewBox="0 0 ${SMALL_CURVE.width} ${SMALL_CURVE.height}" aria-hidden="true">
                <path class=${lone ? "lone" : ""} d=${path}></path>
            </svg>
        `;
  }
  curvePath(entityId, box) {
    const now = Date.now();
    const start = now - HISTORY_HOURS * HOUR;
    const current = valueOf(this.hass, entityId);
    if (!this.historyLoaded) {
      return { path: "", peak: 0, lone: false, points: [], max: 4, start, now };
    }
    const points = curvePoints(this.history, start, now, current);
    const peak = peakOf(this.history, start, current);
    const max = Math.max(peak, 4);
    return { path: linePath(points, start, now, box.width, box.height, max), peak, lone: points.length === 1, points, max, start, now };
  }
  /** Noise and signal on a line, with short names on a narrow card, and the bar between them. */
  meter(sensors) {
    const signal = valueOf(this.hass, sensors.signal);
    const noise = valueOf(this.hass, sensors.noise);
    const places = meter(signal, noise);
    if (!places) {
      return A;
    }
    const gap = places.signal === null ? null : { left: Math.min(places.noise, places.signal), width: Math.abs(places.signal - places.noise) };
    const level = (key, entityId) => b2`<span class="long">${this.text(`meter.${key}`)}</span
                ><span class="short">${this.text(`meter.${key}_short`)}</span> ${this.withUnit(entityId)}`;
    const noiseText = `${this.text("meter.noise")} ${this.withUnit(sensors.noise)}`;
    const signalText = signal === null ? this.text("meter.signal_unknown") : `${this.text("meter.signal")} ${this.withUnit(sensors.signal)}`;
    return b2`
            <div class="meter">
                <div class="levels">
                    <button title=${noiseText} @click=${() => this.moreInfo(sensors.noise)}>${level("noise", sensors.noise)}</button>
                    <button title=${signalText} @click=${() => this.moreInfo(sensors.signal)}>
                        ${signal === null ? this.text("meter.signal_unknown") : level("signal", sensors.signal)}
                    </button>
                </div>
                <div class="bar">
                    ${gap ? b2`<div class="gap" style="left:${gap.left}%;width:${gap.width}%"></div>` : A}
                    <div class="mark noise" style="left:${places.noise}%"></div>
                    ${places.signal === null ? A : b2`<div class="mark signal" style="left:${places.signal}%"></div>`}
                </div>
            </div>
        `;
  }
  feeder(feeder) {
    const entity = this.hass?.states[feeder.entity];
    const detail = feeder.detail ? this.hass?.states[feeder.detail] : void 0;
    const name = feeder.name || entity?.attributes.friendly_name || feeder.entity;
    const missing = (id) => this.text("common.no_entity", { entity: id });
    const parts = [entity ? this.formatState(entity) : missing(feeder.entity)];
    if (feeder.detail) {
      parts.push(detail ? this.formatState(detail) : missing(feeder.detail));
    }
    const value = parts.join(", ");
    return b2`
            <button class="feeder" @click=${() => this.moreInfo(feeder.entity)}>
                <span class="dot ${feederState(entity)}"></span>
                <span class="feeder-name" title=${name}>${name}</span>
                <span class="feeder-value" title=${value}>${value}</span>
            </button>
        `;
  }
  formatState(entity) {
    return this.hass?.formatEntityState ? this.hass.formatEntityState(entity) : entity.state;
  }
  /** The sensor's number in the viewer's format, or a dash when it has none. */
  number(entityId) {
    const value = valueOf(this.hass, entityId);
    return value === null ? "\u2013" : formatNumber(value, this.numberFormat(), entityId ? this.hass?.entities?.[entityId]?.display_precision : void 0);
  }
  withUnit(entityId) {
    const unit = entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : void 0;
    return unit ? `${this.number(entityId)} ${unit}` : this.number(entityId);
  }
  compact() {
    return this.config?.layout === "compact";
  }
  moreInfo(entityId) {
    if (entityId) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    }
  }
  /** A text in the viewer's language, with `{name}` in it replaced, so a translation can put the value where it reads right. */
  text(key, values = {}) {
    return translate(this.language(), key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  }
  numberFormat() {
    return { language: this.language(), number_format: this.hass?.locale?.number_format };
  }
  language() {
    return this.hass?.locale?.language ?? this.hass?.language ?? browserLanguage();
  }
  static get styles() {
    return [
      i`
                ha-card {
                    container-type: inline-size;
                    font-variant-numeric: tabular-nums;
                    --receiver-color: var(--secondary-text-color);
                    --receiver-tint: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
                }

                ha-card.receiving {
                    --receiver-color: var(--success-color, #43a047);
                    --receiver-tint: rgba(var(--rgb-success-color, 67, 160, 71), 0.15);
                }

                ha-card.unavailable {
                    --receiver-color: var(--error-color, #db4437);
                    --receiver-tint: rgba(var(--rgb-error-color, 219, 68, 55), 0.15);
                }

                ha-card.message {
                    padding: 16px;
                    color: var(--secondary-text-color);
                }

                button {
                    padding: 0;
                    border: none;
                    background: none;
                    color: inherit;
                    font: inherit;
                    text-align: inherit;
                    cursor: pointer;
                }

                /*
                 * The full layout's parts step in half rows of a sections view, 32 px, so that with its 24 px of padding and
                 * border the card is 32k − 8 px tall and fills whole or half rows exactly: the top, the figures and the curve
                 * two steps each, the meter and the tabs one each, and in the pane each aircraft and each feeder a step, and the
                 * column heads with the room under the last aircraft one more. The texts keep to one line, cut short with their
                 * whole text as a tooltip.
                 */
                .full {
                    display: flex;
                    flex-direction: column;
                    padding: 11px 16px;
                }

                .full > * {
                    flex: none;
                }

                .name,
                .version,
                .line,
                .figure .label,
                .tab .label,
                .levels button,
                .feeder-name,
                .feeder-value,
                .plane .id,
                .plane .sub,
                .plane-head span,
                .pane .message {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                /* What the rows leave over goes under the top, as padding, which no neighbour's margin can swallow. */
                .top {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    height: 64px;
                    padding-bottom: var(--spare, 0px);
                }

                .icon {
                    flex: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--receiver-color);
                    background: var(--receiver-tint);
                }

                .who {
                    flex: 1;
                    min-width: 0;
                }

                .first {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                }

                .name {
                    min-width: 0;
                    font-size: 16px;
                    font-weight: var(--ha-font-weight-medium, 500);
                }

                .version {
                    flex: none;
                    max-width: 50%;
                    margin-left: auto;
                    font-size: 12px;
                    color: var(--secondary-text-color);
                }

                .line {
                    font-size: 12px;
                    color: var(--secondary-text-color);
                }

                .status {
                    font-size: 13px;
                    color: var(--receiver-color);
                }

                .figures {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    align-items: center;
                    height: 64px;
                    text-align: center;
                }

                .figure {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    min-width: 0;
                    padding: 0 4px;
                    text-align: center;
                }

                .figure + .figure {
                    border-left: 1px solid var(--divider-color);
                }

                .value {
                    white-space: nowrap;
                    font-size: 24px;
                    font-weight: var(--ha-font-weight-medium, 500);
                    line-height: 1.2;
                }

                .unit {
                    font-size: 13px;
                    font-weight: var(--ha-font-weight-normal, 400);
                    color: var(--secondary-text-color);
                }

                .figure .label {
                    max-width: 100%;
                    font-size: 12px;
                    color: var(--secondary-text-color);
                }

                /* The curve and its caption, with room under the caption before the meter. */
                .curve {
                    display: block;
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 64px;
                    padding-top: 4px;
                }

                .plot {
                    position: relative;
                    display: block;
                    height: 36px;
                }

                /* The present value sits on the right edge, and its dot would be cut in half there. */
                .curve svg,
                .small-curve {
                    overflow: visible;
                }

                .curve svg {
                    display: block;
                    width: 100%;
                    height: 36px;
                }

                svg path {
                    fill: none;
                    stroke: var(--primary-color);
                    stroke-width: 2;
                    stroke-linejoin: round;
                    stroke-linecap: round;
                    vector-effect: non-scaling-stroke;
                }

                /* Only the present value, before the recorder has an hour: a dot that shows. */
                svg path.lone {
                    stroke-width: 6;
                }

                svg .base {
                    stroke: var(--divider-color);
                    stroke-width: 1;
                    vector-effect: non-scaling-stroke;
                }

                /* The point under the pointer, and its hour and value above the line. */
                .plot .dot {
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    margin: -4px 0 0 -4px;
                    border-radius: 50%;
                    background: var(--primary-color);
                    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color, #fff));
                    pointer-events: none;
                }

                .tip {
                    position: absolute;
                    bottom: calc(100% + 4px);
                    z-index: 2;
                    transform: translateX(-50%);
                    padding: 3px 8px;
                    border-radius: 4px;
                    background: var(--primary-text-color);
                    color: var(--ha-card-background, var(--card-background-color, #fff));
                    font-size: 12px;
                    white-space: nowrap;
                    pointer-events: none;
                }

                .tip.start {
                    transform: none;
                }

                .tip.end {
                    transform: translateX(-100%);
                }

                .caption {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    font-size: 11px;
                    color: var(--secondary-text-color);
                }

                /* A line of levels and the bar, with room under the bar before the tabs. */
                .meter {
                    height: 32px;
                }

                .levels {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    font-size: 12px;
                    line-height: 18px;
                    color: var(--secondary-text-color);
                }

                .levels button {
                    min-width: 0;
                }

                .short {
                    display: none;
                }

                .bar {
                    position: relative;
                    height: 8px;
                    border-radius: 4px;
                    background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08);
                }

                .gap {
                    position: absolute;
                    top: 0;
                    height: 8px;
                    border-radius: 4px;
                    background: var(--primary-color);
                    opacity: 0.3;
                }

                .mark {
                    position: absolute;
                    top: -3px;
                    width: 3px;
                    height: 14px;
                    margin-left: -1.5px;
                    border-radius: 2px;
                }

                .mark.noise {
                    background: var(--disabled-text-color, #9e9e9e);
                }

                .mark.signal {
                    background: var(--primary-color);
                }

                /* The tabs reach the card's edges, with a line under them that the picked one's underline covers. */
                .tabs {
                    display: flex;
                    height: 32px;
                    margin: 0 -16px;
                    padding: 0 16px;
                    box-shadow: inset 0 -1px var(--divider-color);
                }

                .tab {
                    flex: 1 1 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    min-width: 0;
                    border-bottom: 2px solid transparent;
                    font-size: 13px;
                    color: var(--secondary-text-color);
                }

                .tab.on {
                    border-bottom-color: var(--primary-color);
                    color: var(--primary-text-color);
                }

                .tab .count {
                    flex: none;
                    color: var(--secondary-text-color);
                }

                .tab .problem {
                    flex: none;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--error-color, #db4437);
                }

                /* On a narrow card the version goes, and the meter and the aircraft's tab take their short names. */
                @container (max-width: 299px) {
                    .version,
                    .long {
                        display: none;
                    }

                    .short {
                        display: inline;
                    }

                    .value {
                        font-size: 20px;
                    }

                    .unit {
                        font-size: 12px;
                    }
                }

                /*
                 * Held to a height, by its height mode or a sections view's rows, only the pane scrolls. It reaches out over
                 * the card's padding at the sides and 4 px down, where the focus rings are drawn.
                 */
                ha-card.held {
                    overflow: hidden;
                }

                ha-card.held > .pane {
                    flex: 1 1 auto;
                    min-height: 0;
                    margin: 0 -16px -4px;
                    padding: 0 16px 4px;
                    overflow-y: auto;
                    scrollbar-width: thin;
                }

                /* Filling its rows up to a limit, the pane shrinks but never grows, as the room left over goes under the top
                   and fillRows would otherwise measure it as content, keeping the card from ever shrinking. */
                ha-card.held.filled > .pane {
                    flex-grow: 0;
                }

                .pane .message {
                    padding: 4px 0;
                    font-size: 13px;
                    line-height: 24px;
                    color: var(--secondary-text-color);
                }

                /* The column heads and the room under the last aircraft make one step together. */
                .planes {
                    padding-bottom: 8px;
                }

                .plane-head,
                .plane {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto 56px;
                    align-items: center;
                    gap: 0 8px;
                }

                /* Kept at the top of a held card's pane while the aircraft scroll under it. */
                .plane-head {
                    position: sticky;
                    top: 0;
                    z-index: 1;
                    background: var(--ha-card-background, var(--card-background-color, #fff));
                    padding: 4px 0;
                    font-size: 11px;
                    line-height: 16px;
                    color: var(--secondary-text-color);
                }

                .plane-head span:nth-child(2) {
                    text-align: right;
                }

                /*
                 * Dividers drawn inside the step they top, so they add nothing to its height. A pane without tabs over it
                 * has the tabs' line on its first row, the column heads' kept while the aircraft scroll under them.
                 */
                .plane,
                .feeder + .feeder,
                .pane.alone .plane-head,
                .pane.alone > .message,
                .pane.alone > .feeder:first-child {
                    box-shadow: inset 0 1px var(--divider-color);
                }

                /* Half a row each, its two lines cut short rather than wrapped, so two aircraft fill a row. */
                .plane {
                    grid-template-areas: "id altitude signal" "sub altitude signal";
                    padding-top: 2px;
                    font-size: 13px;
                }

                /* A fixed height, as the position icon would stretch the line box a pixel past the step. */
                .plane .id {
                    grid-area: id;
                    height: 16px;
                    line-height: 16px;
                }

                .plane .callsign {
                    font-weight: 500;
                }

                /* Whether the aircraft's position is known, after its type, centred on the capitals the callsigns and types are. */
                .plane .position {
                    --mdc-icon-size: 14px;
                    margin-left: 4px;
                    color: var(--secondary-text-color);
                    vertical-align: 1px;
                }

                .plane .type {
                    margin-left: 2px;
                    color: var(--secondary-text-color);
                }

                .plane .sub {
                    grid-area: sub;
                    font-size: 11px;
                    line-height: 14px;
                    color: var(--secondary-text-color);
                }

                .plane .altitude {
                    grid-area: altitude;
                    text-align: right;
                    white-space: nowrap;
                }

                .plane .signal {
                    grid-area: signal;
                    position: relative;
                    height: 6px;
                    border-radius: 3px;
                    background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08);
                }

                .plane .signal i {
                    position: absolute;
                    inset: 0 auto 0 0;
                    border-radius: 3px;
                    background: var(--primary-color);
                }

                /* Heard without a position, as the card's figures count it apart. */
                .plane.nopos .callsign {
                    font-weight: 400;
                }

                .plane.nopos .id,
                .plane.nopos .altitude {
                    color: var(--secondary-text-color);
                }

                /* A feeder is a step, its name kept before its value is cut. */
                .feeder {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    width: 100%;
                    height: 32px;
                    font-size: 13px;
                }

                .feeder .dot {
                    flex: none;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--disabled-text-color, #9e9e9e);
                }

                .feeder .dot.ok {
                    background: var(--success-color, #43a047);
                }

                .feeder .dot.error {
                    background: var(--error-color, #db4437);
                }

                .feeder-name {
                    flex: 0 0 auto;
                    max-width: 55%;
                }

                .feeder-value {
                    flex: 0 1 auto;
                    min-width: 0;
                    margin-left: auto;
                    text-align: right;
                    color: var(--secondary-text-color);
                }

                /* One row of a sections view at full width, and centred in the rows it fills or is held to. */
                ha-card.compact {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }

                .compact .row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 9px 14px;
                }

                .compact .icon {
                    width: 36px;
                    height: 36px;
                }

                .compact .name {
                    font-size: 14px;
                    white-space: normal;
                    overflow-wrap: anywhere;
                }

                .compact .status {
                    font-weight: var(--ha-font-weight-normal, 400);
                }

                .compact .line {
                    line-height: 16px;
                    white-space: normal;
                    overflow-wrap: anywhere;
                }

                .piece {
                    white-space: nowrap;
                }

                /* Held, the compact layout's two lines keep to one line each, so it is one row at any width. */
                ha-card.compact.held .name,
                ha-card.compact.held .line {
                    white-space: nowrap;
                }

                .small-curve {
                    flex: none;
                    width: 90px;
                    height: 32px;
                }

                /* Below this the curve would leave the texts too little room, and they matter more. */
                @container (max-width: 279px) {
                    .small-curve {
                        display: none;
                    }
                }
            `,
      fadeStyles
    ];
  }
};
__decorateClass([
  n4({ attribute: false })
], AdsbReceiverCard.prototype, "hass", 2);
__decorateClass([
  n4({ attribute: false })
], AdsbReceiverCard.prototype, "layout", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "config", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "history", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "historyLoaded", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "picked", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "aircraft", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "aircraftFailed", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "clock", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "hover", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "width", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "filled", 2);
__decorateClass([
  r5()
], AdsbReceiverCard.prototype, "spare", 2);
if (!customElements.get("adsb-receiver-card")) {
  console.info(
    `%c  ADSB-RECEIVER-CARD 
%c  ${CARD_VERSION}    `,
    "color: orange; font-weight: bold; background: black",
    "color: white; font-weight: bold; background: dimgray"
  );
  const registry = window;
  registry.customCards = registry.customCards ?? [];
  registry.customCards.push({
    type: "adsb-receiver-card",
    name: translate(browserLanguage(), "common.name"),
    description: translate(browserLanguage(), "common.description"),
    documentationURL: "https://github.com/jesmak/adsb_live#receiver-card",
    preview: true
  });
  customElements.define("adsb-receiver-card", AdsbReceiverCard);
}
export {
  AdsbReceiverCard
};
