(function () {
  if (globalThis.__VF_FLOW_DOM__) return;

/** DOM helpers for Google Flow — selectors may need updates if Google changes UI. */

const VF_LOG = "[Video Flow]";
let vfStep = 0;
let vfRunStart = 0;
let vfCurrentPhase = "";

function vfLog(message, detail) {
  vfStep += 1;
  const elapsed = vfRunStart ? ((Date.now() - vfRunStart) / 1000).toFixed(1) : "0.0";
  const prefix = `${VF_LOG} #${String(vfStep).padStart(2, "0")} +${elapsed}s`;
  const phase = vfCurrentPhase ? ` [${vfCurrentPhase}]` : "";
  if (detail !== undefined) console.log(`${prefix}${phase} ${message}`, detail);
  else console.log(`${prefix}${phase} ${message}`);
}

function vfPhase(name) {
  vfCurrentPhase = name;
  vfLog(`── ${name} ──`);
}

function vfSnapshot() {
  return {
    phase: vfCurrentPhase,
    step: vfStep,
    editorOpen: isImageEditorOpen(),
    uploading: isUploadInProgress(),
    previewLoaded: largePreviewImageLoaded(),
    startSlot: !!findFrameSlot("Start"),
    endSlot: !!findFrameSlot("End"),
    startFilled: slotHasImage("Start"),
    endFilled: slotHasImage("End"),
    composeThumbs: countComposeThumbnails(),
    dialogOpen: !!findOpenDialog(),
    addToPrompt: !!findAddToPromptButton(findOpenDialog() || document.body),
    generateEnabled: generateButtonEnabled?.() ?? null,
    createArrow: !!findCreateArrowButton?.(),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isVisible(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function normText(el) {
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

/** Find Start/End slots in the compose bar (works when Start shows thumbnail only). */
function findComposeSlotElements() {
  let endSlot = null;
  for (const el of document.querySelectorAll('[aria-haspopup="dialog"], div[type="button"]')) {
    if (!isVisible(el)) continue;
    if (normText(el) === "End") {
      endSlot = el;
      break;
    }
  }

  if (!endSlot) {
    return { compose: null, start: null, end: null, slots: [] };
  }

  let compose = endSlot.parentElement;
  for (let i = 0; i < 14 && compose; i++) {
    const hasPrompt = compose.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor="true"]'
    );
    if (hasPrompt) break;
    compose = compose.parentElement;
  }

  const endRect = endSlot.getBoundingClientRect();
  const scope = compose || document.body;
  const popups = [...scope.querySelectorAll('[aria-haspopup="dialog"]')].filter((el) => {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    return Math.abs(r.top - endRect.top) < 48 && r.width < 220;
  });
  popups.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

  return {
    compose,
    start: popups[0] ?? null,
    end: popups[1] ?? endSlot,
    slots: popups,
  };
}

/** Exact label, or position in compose bar when label is hidden (thumbnail only). */
function findFrameSlot(label) {
  const exact = label === "Start" || label === "End" ? label : String(label);
  const selectors = [
    '[aria-haspopup="dialog"]',
    'div[type="button"]',
    "button",
    '[role="button"]',
  ];
  const seen = new Set();
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      if (normText(el) === exact) return el;
    }
  }

  const { start, end } = findComposeSlotElements();
  if (exact === "Start" && start) return start;
  if (exact === "End" && end) return end;
  return null;
}

function findComposeRoot() {
  const { compose, start, end } = findComposeSlotElements();
  if (compose && (start || end)) return compose;

  const startEl = findFrameSlot("Start");
  if (!startEl) return null;
  let cur = startEl.parentElement;
  for (let i = 0; i < 14 && cur; i++) {
    const hasEnd = [...cur.querySelectorAll('[aria-haspopup="dialog"], div[type="button"]')].some(
      (el) => normText(el) === "End"
    );
    const hasPrompt = cur.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor="true"]'
    );
    if (hasEnd && hasPrompt) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function elementHasThumbnail(el) {
  if (!el) return false;
  for (const img of el.querySelectorAll("img")) {
    if (!isVisible(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width >= 16 && r.height >= 16) return true;
  }
  const bg = getComputedStyle(el).backgroundImage;
  if (bg && bg !== "none" && bg.includes("url(")) return true;
  return false;
}

function countComposeThumbnails() {
  const { slots } = findComposeSlotElements();
  return slots.filter((s) => elementHasThumbnail(s)).length;
}

function slotHasImage(slotLabel) {
  const slot = findFrameSlot(slotLabel);
  if (elementHasThumbnail(slot)) return true;

  const { slots } = findComposeSlotElements();
  const idx = slotLabel === "Start" ? 0 : 1;
  if (elementHasThumbnail(slots[idx])) return true;

  const filled = slots.filter((s) => elementHasThumbnail(s)).length;
  if (slotLabel === "Start" && filled >= 1) return true;
  if (slotLabel === "End" && filled >= 2) return true;

  return false;
}

function walkElements(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node instanceof HTMLElement && isVisible(node)) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

function findByTextIncludes(...needles) {
  const lower = needles.map((n) => n.toLowerCase());
  for (const el of walkElements(document.body)) {
    const t = normText(el).toLowerCase();
    if (!t || t.length > 120) continue;
    if (lower.every((n) => t.includes(n))) return el;
  }
  return null;
}

function findNearestClickable(el) {
  let cur = el;
  for (let i = 0; i < 8 && cur; i++) {
    if (
      cur instanceof HTMLButtonElement ||
      cur instanceof HTMLLabelElement ||
      cur instanceof HTMLAnchorElement ||
      cur.getAttribute("role") === "button" ||
      cur.getAttribute("role") === "option" ||
      cur.tabIndex >= 0
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return el;
}

async function clickByText(...needles) {
  const el = findByTextIncludes(...needles);
  if (!el) return false;
  findNearestClickable(el).click();
  await sleep(350);
  return true;
}

function clickExactIn(root, labels) {
  const lower = labels.map((l) => l.toLowerCase());
  const scope = root || document.body;
  for (const el of scope.querySelectorAll("button, [role='button'], div[type='button'], label, a")) {
    if (!isVisible(el)) continue;
    const t = normText(el).toLowerCase();
    if (lower.includes(t)) {
      findNearestClickable(el).click();
      return true;
    }
  }
  return false;
}

function findOpenDialog() {
  const dialogs = [
    ...document.querySelectorAll('[role="dialog"]'),
    ...document.querySelectorAll('[data-radix-popper-content-wrapper]'),
  ].filter(isVisible);
  return dialogs.length ? dialogs[dialogs.length - 1] : null;
}

async function waitForOpenDialog(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = findOpenDialog();
    if (d) return d;
    await sleep(150);
  }
  return null;
}

async function urlToBlob(url) {
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    return res.blob();
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
  return res.blob();
}

function setFilesOnInput(input, blob, filename) {
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitForFileInput(root, timeoutMs = 10000) {
  const scope = root || document;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const inputs = [...scope.querySelectorAll('input[type="file"]')].filter((inp) => !inp.disabled);
    if (inputs.length) return inputs[inputs.length - 1];
    const any = [...document.querySelectorAll('input[type="file"]')];
    if (any.length) return any[any.length - 1];
    await sleep(200);
  }
  throw new Error("Ma-l9inach file input f Google Flow.");
}

function findAddToPromptButton(scope) {
  const root = scope || document.body;
  for (const el of root.querySelectorAll("button, [role='button'], div[type='button']")) {
    if (!isVisible(el)) continue;
    if (normText(el).toLowerCase() === "add to prompt") {
      return findNearestClickable(el);
    }
  }
  return null;
}

function findExactButton(label) {
  for (const el of document.querySelectorAll("button, [role='button'], div[type='button']")) {
    if (!isVisible(el)) continue;
    if (normText(el) === label) return findNearestClickable(el);
  }
  return null;
}

function isImageEditorOpen() {
  return !!findExactButton("Done");
}

function isUploadInProgress() {
  for (const el of walkElements(document.body)) {
    const t = normText(el).toLowerCase();
    if (t === "uploading" || t === "processing" || t.includes("uploading")) return true;
  }
  for (const el of document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')) {
    if (isVisible(el)) return true;
  }
  return false;
}

function largePreviewImageLoaded() {
  for (const img of document.querySelectorAll("img")) {
    if (!isVisible(img)) continue;
    if (img.complete && img.naturalWidth > 80 && img.naturalHeight > 80) {
      const r = img.getBoundingClientRect();
      if (r.width >= 180 && r.height >= 120) return true;
    }
  }
  return false;
}

function filenameVisibleOnPage(filename) {
  const full = filename.toLowerCase();
  const base = full.replace(/\.[^.]+$/, "");
  for (const el of walkElements(document.body)) {
    const t = normText(el).toLowerCase();
    if (t === full || t.startsWith(base)) return true;
  }
  return false;
}

const UPLOAD_SETTLE_MS = 25000;

async function waitForMainGrid(timeoutMs = 15000) {
  vfLog(`waitForMainGrid (max ${timeoutMs / 1000}s)`);
  const start = Date.now();
  let ticks = 0;
  while (Date.now() - start < timeoutMs) {
    ticks += 1;
    if (ticks % 10 === 0) vfLog("waitForMainGrid still waiting…", vfSnapshot());
    if (!isImageEditorOpen() && findComposeRoot()) {
      vfLog("waitForMainGrid OK");
      return;
    }
    await sleep(300);
  }
  vfLog("waitForMainGrid TIMEOUT", vfSnapshot());
}

async function clickDoneIfVisible() {
  const done = findExactButton("Done");
  if (!done) return false;
  vfLog("clicking Done");
  done.click();
  await sleep(1200);
  return true;
}

/**
 * Fixed 25s wait after file pick — enough for Google Flow upload.
 * Clicks Done early if editor opens; always tries Done after 25s.
 */
async function waitForUploadComplete(filename) {
  vfLog(`wait ${UPLOAD_SETTLE_MS / 1000}s for upload: ${filename}`);
  const start = Date.now();

  while (Date.now() - start < UPLOAD_SETTLE_MS) {
    const elapsed = Date.now() - start;

    if (isImageEditorOpen() && elapsed > 4000) {
      const done = findExactButton("Done");
      const busy = done?.disabled || done?.getAttribute("aria-disabled") === "true";
      if (done && !busy) {
        await clickDoneIfVisible();
        await waitForMainGrid();
        vfLog(`upload complete (early Done): ${filename}`);
        return;
      }
    }

    if (elapsed > 8000 && !isImageEditorOpen() && findComposeRoot()) {
      vfLog(`upload complete (on grid): ${filename}`);
      return;
    }

    if (Math.floor(elapsed / 5000) > Math.floor((elapsed - 500) / 5000)) {
      vfLog(`upload waiting ${(elapsed / 1000).toFixed(0)}s / ${UPLOAD_SETTLE_MS / 1000}s`);
    }
    await sleep(500);
  }

  vfLog(`25s done — close editor if needed`);
  if (isImageEditorOpen()) await clickDoneIfVisible();
  await waitForMainGrid(10000);
  vfLog(`upload complete: ${filename}`);
}

async function openUploadMedia() {
  vfLog("openUploadMedia");
  await closeAssetPickerIfOpen();
  await waitForMainGrid(8000);

  const uploadsClicked = clickExactIn(document.body, ["uploads"]) || (await clickByText("uploads"));
  vfLog("Uploads tab", { clicked: uploadsClicked });
  await sleep(600);

  const uploadMediaClicked =
    clickExactIn(document.body, ["upload media"]) || (await clickByText("upload media"));
  vfLog("Upload media button", { clicked: uploadMediaClicked });
  await sleep(700);
}

async function uploadSingleImage(imageUrl, filename) {
  vfPhase(`UPLOAD ${filename}`);
  await openUploadMedia();
  vfLog("waiting for file input…");
  const input = await waitForFileInput();
  vfLog("file input found, setting file…", { filename });
  const blob = await urlToBlob(imageUrl);
  setFilesOnInput(input, blob, filename);
  vfLog("file set, waiting for upload to finish…");
  await waitForUploadComplete(filename);
  await waitForMainGrid();
  await sleep(500);
  vfLog(`uploadSingleImage done: ${filename}`, vfSnapshot());
}

async function waitForAddToPromptReady(scope, timeoutMs = 20000) {
  vfLog("waitForAddToPromptReady…", { timeoutSec: timeoutMs / 1000 });
  const root = scope || document.body;
  const start = Date.now();
  let ticks = 0;
  while (Date.now() - start < timeoutMs) {
    ticks += 1;
    const btn = findAddToPromptButton(root);
    if (btn && isVisible(btn)) {
      const disabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
      const hasPreview =
        largePreviewImageLoaded() ||
        [...root.querySelectorAll("img")].some((img) => img.complete && img.naturalWidth > 40);
      if (!disabled && hasPreview) {
        vfLog("Add to Prompt ready");
        return btn;
      }
      if (ticks % 6 === 0) {
        vfLog("Add to Prompt not ready yet…", { disabled, hasPreview });
      }
    } else if (ticks % 6 === 0) {
      vfLog("Add to Prompt button not found yet…");
    }
    await sleep(350);
  }
  vfLog("waitForAddToPromptReady TIMEOUT", vfSnapshot());
  throw new Error('Ma-l9inach "Add to Prompt" ready (preview loaded).');
}

async function addLastUploadToSlot(slotLabel) {
  vfPhase(`ADD TO SLOT: ${slotLabel}`);
  await waitForMainGrid();

  vfLog(`clicking ${slotLabel} slot…`);
  const scope = await openAssetPickerViaSlot(slotLabel);
  vfLog("asset picker open", { hasDialog: !!findOpenDialog() });
  await sleep(1000);

  const addBtn = await waitForAddToPromptReady(scope);
  vfLog('clicking "Add to Prompt"');
  addBtn.click();
  await sleep(1400);

  vfLog("closing picker…");
  await closeAssetPickerIfOpen();
  await sleep(600);
  vfLog(`${slotLabel} added`);
}

async function openAssetPickerViaSlot(slotLabel) {
  const slot = findFrameSlot(slotLabel);
  if (!slot) throw new Error(`Ma-l9inach slot "${slotLabel}".`);
  slot.click();
  await sleep(1000);
  const dialog = await waitForOpenDialog();
  return dialog || document.body;
}

async function closeAssetPickerIfOpen() {
  const dialog = findOpenDialog();
  if (!dialog) return;

  const closeBtn =
    dialog.querySelector('button[aria-label="Close"]') ||
    dialog.querySelector('button[aria-label="close"]');
  if (closeBtn instanceof HTMLElement) {
    closeBtn.click();
    await sleep(400);
    return;
  }

  const rect = dialog.getBoundingClientRect();
  const target = document.elementFromPoint(Math.max(8, rect.left - 30), rect.top + rect.height / 2);
  if (target instanceof HTMLElement) {
    target.click();
    await sleep(400);
  }
}

const PROMPT_PLACEHOLDERS = [
  "what do you want to create",
  "what do you want to change",
  "describe your video",
  "describe the action",
];

function fieldMatchesPromptHints(field) {
  if (!(field instanceof HTMLElement)) return false;
  const ph = (
    field.getAttribute("placeholder") ||
    field.getAttribute("aria-label") ||
    field.getAttribute("data-placeholder") ||
    ""
  ).toLowerCase();
  if (PROMPT_PLACEHOLDERS.some((p) => ph.includes(p))) return true;

  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = document.getElementById(labelledBy);
    const lt = normText(label || "").toLowerCase();
    if (PROMPT_PLACEHOLDERS.some((p) => lt.includes(p))) return true;
  }
  return false;
}

function getSlateEditorRoot(el) {
  if (!el) return el;
  if (el.getAttribute?.("data-slate-editor") === "true") return el;
  const slate = el.closest?.('[data-slate-editor="true"]');
  if (slate instanceof HTMLElement) return slate;
  if (el.getAttribute?.("data-lexical-editor") === "true") return el;
  const lexical = el.closest?.('[data-lexical-editor="true"]');
  if (lexical instanceof HTMLElement) return lexical;
  if (el.isContentEditable) {
    let node = el;
    while (node.parentElement?.isContentEditable) node = node.parentElement;
    return node;
  }
  return el;
}

function getEditableTarget(field) {
  if (!field) return null;
  const candidate =
    field.querySelector('[data-slate-editor="true"]') ||
    field.querySelector('[data-lexical-editor="true"]') ||
    field.querySelector('[contenteditable="true"]') ||
    field;
  return getSlateEditorRoot(candidate instanceof HTMLElement ? candidate : field);
}

function resolvePromptEditor() {
  const field = findPromptField();
  if (!field) return null;
  const root = getEditableTarget(field);
  return root ? { field, root } : null;
}

function placeCaretAtEnd(root) {
  if (!root) return false;
  root.focus();
  try {
    const sel = window.getSelection();
    if (!sel) return false;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function isClickableControl(el) {
  if (!el || !(el instanceof HTMLElement) || !isVisible(el)) return false;
  if (el.disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;

  const style = getComputedStyle(el);
  if (style.pointerEvents === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) < 0.35) return false;

  let parent = el.parentElement;
  for (let i = 0; i < 5 && parent; i++) {
    if (parent.getAttribute("aria-disabled") === "true") return false;
    if (parent.disabled) return false;
    parent = parent.parentElement;
  }
  return true;
}

function buttonIsCreateArrow(btn) {
  if (!(btn instanceof HTMLElement) || !isVisible(btn)) return false;

  for (const icon of btn.querySelectorAll("i.google-symbols, i[class*='google-symbols']")) {
    const t = normText(icon);
    if (t === "arrow_forward" || t.includes("arrow_forward")) return true;
  }

  for (const span of btn.querySelectorAll("span")) {
    if (normText(span) === "Create") return true;
  }

  const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
  return aria === "create" || aria.includes("create");
}

/** Google Flow submit: <button><i class="google-symbols">arrow_forward</i><span>Create</span></button> */
function findCreateArrowButton() {
  const candidates = [];
  for (const btn of document.querySelectorAll("button, [role='button']")) {
    if (buttonIsCreateArrow(btn)) candidates.push(btn);
  }
  if (!candidates.length) return null;

  const prompt = findPromptField();
  if (prompt) {
    const pr = prompt.getBoundingClientRect();
    const near = candidates.filter((b) => {
      const br = b.getBoundingClientRect();
      return Math.abs(br.top - pr.top) < 140 && br.left >= pr.left - 80;
    });
    if (near.length) {
      return near.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    }
  }

  return candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
}

function findComposeActionButtons() {
  const compose = findComposeRoot();
  if (!compose) return [];

  const controls = [
    ...compose.querySelectorAll("button, [role='button'], div[type='button']"),
  ].filter(isVisible);

  const prompt = findPromptField();
  if (prompt) {
    let row = prompt.parentElement;
    for (let i = 0; i < 10 && row && compose.contains(row); i++) {
      const inRow = controls.filter((b) => row.contains(b));
      if (inRow.length) {
        return inRow.sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right);
      }
      row = row.parentElement;
    }
  }

  return controls.sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right);
}

function findGenerateButton() {
  const arrow = findCreateArrowButton();
  if (arrow) return arrow;

  const buttons = findComposeActionButtons();
  if (!buttons.length) return null;

  for (const b of buttons) {
    if (buttonIsCreateArrow(b)) return b;
  }

  for (const b of buttons) {
    const aria = (b.getAttribute("aria-label") || "").toLowerCase();
    if (/generate|submit|create|send|run|arrow/.test(aria)) {
      return findNearestClickable(b);
    }
  }

  for (const b of buttons) {
    if (!b.querySelector("svg, i.google-symbols")) continue;
    const r = b.getBoundingClientRect();
    if (r.width <= 88 && r.height <= 88) return findNearestClickable(b);
  }

  return findNearestClickable(buttons[buttons.length - 1]);
}

function generateButtonEnabled() {
  const btn = findGenerateButton();
  if (!btn) return false;
  return isClickableControl(btn);
}

function findPromptField() {
  const compose = findComposeRoot();

  if (compose) {
    for (const el of compose.querySelectorAll(
      '[contenteditable="true"], [data-lexical-editor="true"], [role="textbox"], textarea'
    )) {
      if (!isVisible(el)) continue;
      const ph = (
        el.getAttribute("placeholder") ||
        el.getAttribute("aria-placeholder") ||
        el.getAttribute("data-placeholder") ||
        ""
      ).toLowerCase();
      if (PROMPT_PLACEHOLDERS.some((p) => ph.includes(p))) return el;
    }

    const editables = [...compose.querySelectorAll('[contenteditable="true"]')].filter(isVisible);
    if (editables.length === 1) return editables[0];
    if (editables.length > 1) {
      return editables.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      })[0];
    }
  }

  const candidates = [];
  const roots = compose ? [compose, document.body] : [document.body];

  for (const root of roots) {
    for (const sel of [
      "textarea",
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[data-lexical-editor="true"]',
    ]) {
      for (const el of root.querySelectorAll(sel)) {
        if (isVisible(el)) candidates.push(el);
      }
    }
  }

  for (const field of candidates) {
    if (fieldMatchesPromptHints(field)) return field;
  }

  if (compose) {
    const inCompose = candidates.filter((el) => compose.contains(el));
    if (inCompose.length === 1) return inCompose[0];
    if (inCompose.length > 1) {
      return inCompose.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      })[0];
    }
  }

  for (const ta of [...document.querySelectorAll("textarea")].filter(isVisible)) {
    const ph = (ta.getAttribute("placeholder") || "").toLowerCase();
    if (PROMPT_PLACEHOLDERS.some((p) => ph.includes(p))) return ta;
  }

  for (const el of walkElements(document.body)) {
    const t = normText(el).toLowerCase();
    if (t !== "what do you want to create?" && t !== "what do you want to create") continue;
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++) {
      const ed = p.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor="true"]'
      );
      if (ed && isVisible(ed)) return ed;
      p = p.parentElement;
    }
  }

  return candidates[candidates.length - 1] || null;
}

function findReactTextHandler(el) {
  let node = el;
  for (let depth = 0; depth < 24 && node; depth++) {
    for (const key of Object.keys(node)) {
      if (key.startsWith("__reactProps")) {
        const props = node[key];
        for (const name of ["onChange", "onInput", "onValueChange", "onBlur"]) {
          if (typeof props?.[name] === "function") return { fn: props[name], name };
        }
      }
      if (key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")) {
        let fiber = node[key];
        for (let i = 0; i < 20 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props) {
            for (const name of ["onChange", "onInput", "onValueChange"]) {
              if (typeof props[name] === "function") return { fn: props[name], name };
            }
          }
          fiber = fiber.return;
        }
      }
    }
    node = node.parentElement;
  }
  return null;
}

function invokeReactTextHandler(el, value) {
  const found = findReactTextHandler(el);
  if (!found) return false;
  const target = {
    value,
    innerText: value,
    textContent: value,
    innerHTML: value,
  };
  found.fn({ target, currentTarget: el, nativeEvent: new Event("input") });
  return true;
}

function setReactInputValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
  if (setter) setter.call(el, value);
  else if ("value" in el) el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function readPromptValue(field) {
  const root = getSlateEditorRoot(field);
  if (root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement) {
    return root.value || "";
  }
  return normText(root);
}

function promptWasApplied(el, expectedText) {
  const got = readPromptValue(el).length;
  const want = String(expectedText || "").length;
  if (!want) return got === 0;
  if (want <= 40) return got >= want * 0.85;
  return got >= Math.min(want * 0.85, want - 80);
}

/** Clear prompt field — Slate-safe (no execCommand on inner spans). */
function clearFieldOnly(el) {
  const root = getSlateEditorRoot(el);
  root.focus();
  root.click();

  if (root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement) {
    setReactInputValue(root, "");
    return;
  }

  clearSlateField(root);
}

function getSlateCaretRange(root) {
  const leaves = root.querySelectorAll('[data-slate-leaf="true"]');
  const leaf = leaves.length ? leaves[leaves.length - 1] : null;
  if (leaf) {
    const tn = leaf.firstChild;
    if (tn?.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.setStart(tn, tn.textContent?.length ?? 0);
      range.collapse(true);
      return range;
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(leaf);
      range.collapse(false);
      return range;
    } catch {
      /* fall through */
    }
  }

  const zw =
    root.querySelector('[data-slate-zero-width="n"]') ||
    root.querySelector('[data-slate-zero-width]');
  if (zw) {
    const range = document.createRange();
    range.setStart(zw, 0);
    range.collapse(true);
    return range;
  }

  const block = root.querySelector('[data-slate-node="element"]');
  if (block) {
    try {
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      return range;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function placeCaretInSlateEditor(root) {
  const range = getSlateCaretRange(root);
  if (!range) return false;
  root.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

function clearSlateField(root) {
  if (readPromptValue(root).length === 0) return;

  const element = root.querySelector('[data-slate-node="element"]') || root;
  const range = document.createRange();
  try {
    range.selectNodeContents(element);
  } catch {
    return;
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const before = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: "deleteContentBackward",
  });
  Object.defineProperty(before, "getTargetRanges", {
    configurable: true,
    value: () => [range.cloneRange()],
  });
  root.dispatchEvent(before);
}

/** Slate/Lexical beforeinput with getTargetRanges — never use execCommand insertText. */
function dispatchSlateBeforeInput(root, inputType, data) {
  placeCaretInSlateEditor(root);
  const range = getSlateCaretRange(root);
  if (!range) return false;

  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType,
  };
  if (data != null) init.data = data;
  if (inputType === "insertFromPaste" && data) {
    const dt = new DataTransfer();
    dt.setData("text/plain", data);
    init.dataTransfer = dt;
  }

  const before = new InputEvent("beforeinput", init);
  Object.defineProperty(before, "getTargetRanges", {
    configurable: true,
    value: () => [range.cloneRange()],
  });
  root.dispatchEvent(before);

  root.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType,
      data: data ?? undefined,
    })
  );
  return true;
}

async function setPromptViaLexicalApi(text) {
  try {
    const res = await chrome.runtime.sendMessage({
      type: "VF_LEXICAL_SET_PROMPT",
      text,
    });
    return res?.ok === true;
  } catch (e) {
    vfLog("Lexical API message failed", e?.message);
    return false;
  }
}

async function typePromptSlateSafe(root, text) {
  clearSlateField(root);
  await sleep(200);
  root.focus();
  root.click();

  vfLog("try Slate insertFromPaste (getTargetRanges)");
  dispatchSlateBeforeInput(root, "insertFromPaste", text);
  await sleep(500);
  if (promptWasApplied(root, text) && generateButtonEnabled()) {
    vfLog("prompt ok (insertFromPaste)");
    return;
  }

  clearSlateField(root);
  await sleep(200);
  placeCaretInSlateEditor(root);

  const parts = String(text).match(/\S+|\s+/g) || [text];
  vfLog("Slate word-by-word (getTargetRanges, no execCommand)", { words: parts.length });

  for (let i = 0; i < parts.length; i++) {
    dispatchSlateBeforeInput(root, "insertText", parts[i]);
    if ((i + 1) % 25 === 0) await sleep(15);
    else if ((i + 1) % 5 === 0) await sleep(6);
  }

  invokeReactTextHandler(root, text);
  root.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(400);
}

/** Fill prompt — Lexical setEditorState first, then Slate-safe fallback. */
async function setPromptText(text) {
  vfPhase("SET PROMPT");

  let resolved = resolvePromptEditor();
  if (!resolved) {
    vfLog("prompt field NOT FOUND", vfSnapshot());
    throw new Error("Ma-l9inach prompt field f Google Flow.");
  }

  let { root: el } = resolved;
  const chars = String(text || "").length;
  vfLog("set prompt", { chars });

  el.focus();
  el.click();
  await sleep(200);

  vfLog("try Lexical setEditorState (page MAIN world)");
  const lexicalOk = await setPromptViaLexicalApi(text);
  if (lexicalOk) {
    await sleep(500);
    resolved = resolvePromptEditor();
    if (resolved) el = resolved.root;
    if (generateButtonEnabled() && promptWasApplied(el, text)) {
      vfLog("prompt ok (Lexical setEditorState)");
      return;
    }
    vfLog("Lexical setEditorState did not enable Generate — Slate fallback");
  } else {
    vfLog("Lexical setEditorState unavailable — Slate fallback");
  }

  resolved = resolvePromptEditor();
  if (!resolved) {
    throw new Error("Prompt field lost after Lexical insert — refresh Flow tab.");
  }
  await typePromptSlateSafe(resolved.root, text);

  el.focus();
  await sleep(300);

  vfLog("prompt done", {
    chars: readPromptValue(el).length,
    generateEnabled: generateButtonEnabled(),
  });
}

async function applyFlowSettings(settings = {}) {
  if (settings.videoMode) {
    await clickByText(settings.videoMode.toLowerCase());
    await clickByText("frames to video");
  }

  if (settings.aspectRatio) {
    const ratio = settings.aspectRatio.replace(/\s/g, "");
    (await clickByText("9:16")) || (await clickByText(ratio)) || (await clickByText("portrait"));
  }

  if (settings.model) {
    const model = String(settings.model);
    (await clickByText(model.toLowerCase())) ||
      ((await clickByText("veo")) && (await clickByText(model.split(" ")[0].toLowerCase())));
  }

  if (settings.duration) {
    const d = String(settings.duration).replace(/s$/i, "");
    (await clickByText(`${d}s`)) ||
      (await clickByText(`video - ${d}s`)) ||
      (await clickByText(`video · ${d}s`));
  }

  if (settings.outputs) {
    const n = String(settings.outputs);
    if (n !== "1") await clickByText(`x${n}`);
  }
}

async function clickGenerate() {
  const btn = findCreateArrowButton() || findGenerateButton();
  if (!btn) {
    vfLog("Create arrow button NOT FOUND", vfSnapshot());
    return false;
  }

  if (!isClickableControl(btn)) {
    vfLog("Create arrow not clickable", {
      disabled: btn.disabled,
      ariaDisabled: btn.getAttribute("aria-disabled"),
    });
    return false;
  }

  vfLog("clicking Create arrow", {
    tag: btn.tagName,
    icon: normText(btn.querySelector("i.google-symbols, i") || ""),
    ariaDisabled: btn.getAttribute("aria-disabled"),
  });

  btn.focus();
  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  btn.click();
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(500);
  return true;
}

/**
 * @param {{ debutImageUrl: string, finImageUrl: string, prompt: string, sceneNumber?: number }} scene
 * @param {{ autoRun?: boolean, aspectRatio?: string, model?: string, videoMode?: string, duration?: string, outputs?: string }} settings
 */
async function fillGoogleFlowScene(scene, settings = {}) {
  vfStep = 0;
  vfRunStart = Date.now();
  vfCurrentPhase = "INIT";
  console.group(`${VF_LOG} fillGoogleFlowScene — scene ${scene.sceneNumber ?? 1}`);
  vfLog("started", {
    sceneNumber: scene.sceneNumber,
    debutUrl: scene.debutImageUrl?.slice(0, 40) + "…",
    finUrl: scene.finImageUrl?.slice(0, 40) + "…",
    promptWords: String(scene.prompt || "").trim().split(/\s+/).length,
    autoRun: settings.autoRun !== false,
  });

  try {
    const n = scene.sceneNumber ?? 1;
    const prompt = String(scene.prompt || "").trim();
    if (!prompt) throw new Error("Prompt khawi.");

    const debutName = `scene-${n}-debut.jpg`;
    const finName = `scene-${n}-fin.jpg`;

    vfPhase("SETTINGS");
    await applyFlowSettings(settings);
    await sleep(500);
    vfLog("settings applied", vfSnapshot());

    await uploadSingleImage(scene.debutImageUrl, debutName);
    await addLastUploadToSlot("Start");

    await uploadSingleImage(scene.finImageUrl, finName);
    await addLastUploadToSlot("End");

    await sleep(800);
    await setPromptText(prompt);
    await sleep(500);

    if (settings.autoRun !== false) {
      vfPhase("GENERATE");
      const genBtn = findGenerateButton();
      vfLog("generate state", {
        found: !!genBtn,
        enabled: generateButtonEnabled(),
        aria: genBtn?.getAttribute("aria-label") || null,
      });

      const ran = await clickGenerate();
      vfLog("clickGenerate", { ran });
      if (!ran) {
        vfLog("Generate click failed — click arrow manually", vfSnapshot());
        console.groupEnd();
        return {
          ok: true,
          autoRun: false,
          needsManualGenerate: true,
          message: "Images filled. Click Generate arrow manually.",
        };
      }
    }

    vfLog("SUCCESS", vfSnapshot());
    console.groupEnd();
    return { ok: true, autoRun: settings.autoRun !== false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${VF_LOG} FAILED at step #${vfStep} [${vfCurrentPhase}]:`, msg);
    console.error(`${VF_LOG} snapshot:`, vfSnapshot());
    if (e instanceof Error && e.stack) console.error(e.stack);
    console.groupEnd();
    throw e;
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__VF_FLOW_DOM__ = { fillGoogleFlowScene, sleep, applyFlowSettings };
  globalThis.__VF_FLOW_DEBUG__ = { vfLog, vfSnapshot, getStep: () => vfStep, getPhase: () => vfCurrentPhase };
}
})();
