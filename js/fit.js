// Fit-to-box rule: when text does not fit its box, shrink the font (down to a floor) instead of cutting or breaking it.
// Runs after every render through a MutationObserver. Layout only; never touches game state.
const SINGLE = ".pill span, .stat small, .tab, .scenes button, .mb, .tag, .sup b, .mini, .ctrl button, .brand small, .field > span, .kv span, .kv b, .mode small, .helptabs button";
const MIN = 7;

function fitOne(el) {
  el.style.fontSize = "";
  if (el.clientWidth === 0) return;
  let size = parseFloat(getComputedStyle(el).fontSize), guard = 40;
  while (el.scrollWidth > el.clientWidth + 1 && size > MIN && guard--) { size -= 0.5; el.style.fontSize = size + "px"; }
}
function fitTable(t) {
  // scale the whole table (text, inputs, buttons) together so columns keep their proportions
  const box = t.closest(".scroll") || t.parentElement; if (!box) return;
  t.style.zoom = "";
  const need = t.scrollWidth, have = box.clientWidth;
  if (need > have + 1) t.style.zoom = String(Math.max(0.6, have / need));
}
export function fitAll(root = document) {
  root.querySelectorAll(SINGLE).forEach(fitOne);
  root.querySelectorAll(".tbl").forEach(fitTable);
}

export function startFit() {
  let timer = 0, busy = false;
  const run = () => { timer = 0; busy = true; obs.disconnect(); try { fitAll(); } finally { watch(); busy = false; } };
  const queue = () => { if (!timer && !busy) timer = setTimeout(run, 60); };
  const obs = new MutationObserver(queue);
  const watch = () => obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  watch(); window.addEventListener("resize", queue); window.addEventListener("orientationchange", queue);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
  queue();
}
