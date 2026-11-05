// Update a piece of the page in place instead of replacing it. Only the parts that really changed are touched, so scroll position, the
// open drop-down, hover, text selection and the focused field survive a refresh. No library: it walks the old and new trees together.
const same = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;
const FORM = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };
function syncAttrs(a, b) {
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
}
function update(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  syncAttrs(a, b); patchChildren(a, b);
  if (FORM[a.nodeName] && a !== document.activeElement) {                       // never touch the field someone is using
    if (a.type === "checkbox" || a.type === "radio") { if (a.checked !== b.checked) a.checked = b.checked; }
    else if (a.value !== b.value) a.value = b.value;
  }
}
function patchChildren(a, b) {
  const an = a.childNodes, bn = b.childNodes;
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) a.appendChild(y.cloneNode(true));
    else if (!same(x, y)) a.replaceChild(y.cloneNode(true), x);
    else update(x, y);
  }
  while (an.length > bn.length) a.removeChild(a.lastChild);
}
export function morph(root, html) {
  const t = document.createElement("template"); t.innerHTML = html; patchChildren(root, t.content);
}
