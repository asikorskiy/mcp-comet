export function buildSubmitPromptScript(): string {
  return `(function() {
    var input = document.querySelector('#ask-input') || document.querySelector('[contenteditable="true"]');
    if (!input || !(input.innerText || input.value || '').trim()) return 'empty_input';
    var button = document.querySelector('button[aria-label="Submit"]');
    if (!button || button.disabled) return 'submit_unavailable';
    button.click();
    return 'clicked_submit';
  })()`
}

/** Map internal mode names to SVG icon href identifiers (locale-independent). */
const MODE_ICONS: Record<string, string> = {
  standard: '',
  'deep-research': '#pplx-icon-telescope',
  'model-council': '#pplx-icon-gavel',
  create: '#pplx-icon-custom-computer',
  learn: '#pplx-icon-book',
  review: '#pplx-icon-file-check',
  computer: '#pplx-icon-click',
}

/** Only a blank home composer can safely use the slash typeahead. */
export function buildModePreflightScript(): string {
  return ` (function() {
    var input = document.querySelector('#ask-input') || document.querySelector('[contenteditable="true"]');
    return JSON.stringify({
      url: location.href,
      hasInput: !!input,
      hasDraft: !!(input && (input.innerText || input.value || '').trim())
    });
  })()`.trim()
}

/** Click a mode item after the caller opens the slash menu in the active composer. */
export function buildModeSwitchScript(mode: string): string {
  const iconHref = MODE_ICONS[mode] ?? (mode ? `#pplx-icon-${mode}` : '')
  const modeLabel =
    (
      {
        'deep-research': 'deep research',
        'model-council': 'model council',
        create: 'create',
        learn: 'learn',
        review: 'review',
        computer: 'computer',
      } as Record<string, string>
    )[mode] ?? mode
  return `(function() {
    var iconHref = ${JSON.stringify(iconHref)};
    var modeLabel = ${JSON.stringify(modeLabel)};
    if (!iconHref) return 'standard_mode_no_action';

    var listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return 'no_listbox_found';

    var menuItems = document.querySelectorAll('[role="menuitem"]');
    for (var i = 0; i < menuItems.length; i++) {
      var item = menuItems[i];
      // Skip shortcut items (slash commands like /write, /teach-me-comet)
      if (item.className.indexOf('shortcut-typeahead-option') !== -1) continue;

      // Match by icon SVG use href
      var useEls = item.querySelectorAll('use');
      for (var u = 0; u < useEls.length; u++) {
        var href = useEls[u].getAttribute('xlink:href') || useEls[u].getAttribute('href') || '';
        if (href === iconHref) {
          item.click();
          return 'clicked:' + iconHref;
        }
      }
      // Comet frequently changes SVG names; text labels are the fallback.
      if ((item.textContent || '').trim().toLowerCase().includes(modeLabel)) {
        item.click();
        return 'clicked:' + modeLabel;
      }
    }
    return 'menu_item_not_found:' + iconHref;
  })()`
}

export function buildNewChatScript(): string {
  return `(function() { location.href = 'https://www.perplexity.ai'; return 'navigating'; })()`
}

/** Reverse map: SVG icon href → internal mode name. */
const ICON_TO_MODE: Record<string, string> = {
  '#pplx-icon-telescope': 'deep-research',
  '#pplx-icon-gavel': 'model-council',
  '#pplx-icon-book': 'learn',
  '#pplx-icon-file-check': 'review',
  '#pplx-icon-click': 'computer',
  '#pplx-icon-custom-computer': 'computer',
}

/**
 * Build script to read the active mode from the typeahead menu.
 * Assumes the typeahead is already open (caller must open it via CDP first).
 * Returns the mode name or "standard" if no active item found.
 */
export function buildReadActiveModeScript(): string {
  const iconToModeEntries = Object.entries(ICON_TO_MODE)
    .map(([icon, mode]) => `if (href === ${JSON.stringify(icon)}) return ${JSON.stringify(mode)};`)
    .join('\n      ')

  return `(function() {
    var url = window.location.href;
    if (url.indexOf('/copilot/') !== -1) return 'computer';
    if (url.indexOf('/computer/tasks/') !== -1) return 'computer';

    var items = document.querySelectorAll('[role="menuitem"]');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.className.indexOf('shortcut-typeahead-option') !== -1) continue;
      // Check if this item has the active/selected background
      var inner = item.querySelector('.bg-subtle');
      if (!inner) continue;
      var useEl = item.querySelector('use');
      if (!useEl) continue;
      var href = useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '';
      ${iconToModeEntries}
    }
    return 'standard';
  })()`
}

/**
 * Map internal mode names to the visible composer mode chip label.
 * Comet 2026-10 moved mode switching from the "/" slash typeahead to a
 * chip dropdown on the composer toolbar; the chip shows the ACTIVE mode.
 */
const MODE_CHIP_LABELS: Record<string, string> = {
  standard: 'search',
  'deep-research': 'deep research',
  'model-council': 'model council',
  create: 'create',
  learn: 'learn',
  review: 'review',
  computer: 'computer',
}

/** Map a composer chip label (e.g. "Deep research") back to the internal mode name. */
export function chipLabelToMode(label: string): string | null {
  const value = String(label || '')
    .trim()
    .toLowerCase()
  if (!value) return null
  // Exact match first so "deep research" is not swallowed by "search".
  for (const [mode, chip] of Object.entries(MODE_CHIP_LABELS)) {
    if (value === chip) return mode
  }
  // Then prefer the longest label contained in the chip text
  // ("Learn step by step" -> learn).
  let best: { mode: string; length: number } | null = null
  for (const [mode, chip] of Object.entries(MODE_CHIP_LABELS)) {
    if (value.includes(chip) && (!best || chip.length > best.length)) {
      best = { mode, length: chip.length }
    }
  }
  return best ? best.mode : null
}

/**
 * Build script to locate the composer mode chip dropdown trigger and the
 * composer input center. The chip is the first visible, unlabeled text
 * button vertically aligned with the composer input (labeled buttons such
 * as "Add files or tools", the model selector, and submit are excluded).
 */
export function buildModeChipScript(): string {
  return `(function() {
    var input = document.querySelector('#ask-input') || document.querySelector('[contenteditable="true"]');
    if (!input) return JSON.stringify({ found: false, reason: 'no_input' });
    var ir = input.getBoundingClientRect();
    var icy = ir.y + ir.height / 2;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.getAttribute('aria-label')) continue;
      if (b.getAttribute('aria-haspopup')) continue;
      var tx = (b.textContent || '').trim();
      if (!tx) continue;
      var r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      var cy = r.y + r.height / 2;
      if (Math.abs(cy - icy) > 80) continue;
      return JSON.stringify({
        found: true,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(cy),
        label: tx,
        icx: Math.round(ir.x + ir.width / 2),
        icy: Math.round(icy)
      });
    }
    return JSON.stringify({ found: false, reason: 'mode_chip_not_found' });
  })()`
}

/**
 * Build script to locate the target mode item inside the OPEN mode chip
 * dropdown. Comet renders mode entries as role="menuitemradio" (not the
 * legacy slash-typeahead role="menuitem"), so both roles are scanned and
 * hidden (zero-size) entries are skipped.
 */
export function buildModeMenuItemScript(mode: string): string {
  const iconHref = MODE_ICONS[mode] ?? (mode ? `#pplx-icon-${mode}` : '')
  const modeLabel =
    (
      {
        'deep-research': 'deep research',
        'model-council': 'model council',
        create: 'create',
        learn: 'learn',
        review: 'review',
        computer: 'computer',
      } as Record<string, string>
    )[mode] ?? mode
  return `(function() {
    var iconHref = ${JSON.stringify(iconHref)};
    var modeLabel = ${JSON.stringify(modeLabel)};
    var items = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (String(item.className || '').indexOf('shortcut-typeahead-option') !== -1) continue;
      var rect = item.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      var hit = false;
      if (iconHref) {
        var uses = item.querySelectorAll('use');
        for (var u = 0; u < uses.length; u++) {
          var href = uses[u].getAttribute('xlink:href') || uses[u].getAttribute('href') || '';
          if (href === iconHref) { hit = true; break; }
        }
      }
      if (!hit && modeLabel && (item.textContent || '').trim().toLowerCase().indexOf(modeLabel) !== -1) hit = true;
      if (hit) {
        return JSON.stringify({
          found: true,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          label: (item.textContent || '').trim(),
          role: item.getAttribute('role'),
          checked: item.getAttribute('aria-checked')
        });
      }
    }
    return JSON.stringify({ found: false });
  })()`
}

/**
 * Build script that opens the composer mode chip dropdown by dispatching a
 * full pointer event sequence on the trigger. Comet (Chrome 153) wires the
 * Radix trigger to pointer events; plain synthetic clicks and CDP mouse
 * events no longer open the menu.
 */
export function buildModeChipClickScript(): string {
  return `(function() {
    var input = document.querySelector('#ask-input') || document.querySelector('[contenteditable="true"]');
    if (!input) return JSON.stringify({ clicked: false, reason: 'no_input' });
    var ir = input.getBoundingClientRect();
    var icy = ir.y + ir.height / 2;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.getAttribute('aria-label')) continue;
      if (b.getAttribute('aria-haspopup')) continue;
      var tx = (b.textContent || '').trim();
      if (!tx) continue;
      var r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (Math.abs(r.y + r.height / 2 - icy) > 80) continue;
      var opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      b.dispatchEvent(new PointerEvent('pointerdown', opts));
      b.dispatchEvent(new MouseEvent('mousedown', opts));
      b.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
      b.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opts, { buttons: 0 })));
      b.dispatchEvent(new MouseEvent('click', Object.assign({}, opts, { buttons: 0 })));
      return JSON.stringify({ clicked: true, label: tx });
    }
    return JSON.stringify({ clicked: false, reason: 'mode_chip_not_found' });
  })()`
}

/**
 * Build script that clicks the target mode item inside the OPEN chip
 * dropdown via a full pointer event sequence. Reports whether the menu was
 * visible at all so callers can distinguish a closed menu from a missing
 * item.
 */
export function buildModeMenuItemClickScript(mode: string): string {
  const iconHref = MODE_ICONS[mode] ?? (mode ? `#pplx-icon-${mode}` : '')
  const modeLabel =
    (
      {
        'deep-research': 'deep research',
        'model-council': 'model council',
        create: 'create',
        learn: 'learn',
        review: 'review',
        computer: 'computer',
      } as Record<string, string>
    )[mode] ?? mode
  return `(function() {
    var iconHref = ${JSON.stringify(iconHref)};
    var modeLabel = ${JSON.stringify(modeLabel)};
    var items = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    var visibleItems = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (String(it.className || '').indexOf('shortcut-typeahead-option') !== -1) continue;
      var r = it.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      visibleItems++;
      var hit = false;
      if (iconHref) {
        var uses = it.querySelectorAll('use');
        for (var u = 0; u < uses.length; u++) {
          var href = uses[u].getAttribute('xlink:href') || uses[u].getAttribute('href') || '';
          if (href === iconHref) { hit = true; break; }
        }
      }
      if (!hit && modeLabel && (it.textContent || '').trim().toLowerCase().indexOf(modeLabel) !== -1) hit = true;
      if (hit) {
        var opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        it.dispatchEvent(new PointerEvent('pointerdown', opts));
        it.dispatchEvent(new MouseEvent('mousedown', opts));
        it.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
        it.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opts, { buttons: 0 })));
        it.dispatchEvent(new MouseEvent('click', Object.assign({}, opts, { buttons: 0 })));
        return JSON.stringify({ clicked: true, label: (it.textContent || '').trim(), role: it.getAttribute('role') });
      }
    }
    return JSON.stringify({ clicked: false, menuOpen: visibleItems > 0 });
  })()`
}
