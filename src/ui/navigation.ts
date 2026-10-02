export function buildSubmitPromptScript(): string {
  return `(function() {
    var active = document.activeElement;
    if (active) {
      active.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
      active.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
    }
    return 'submitted';
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
