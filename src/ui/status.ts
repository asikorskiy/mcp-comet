import { buildFindProseJS } from '../prose-filter.js'
import type { SelectorSet } from '../selectors/types.js'
import { SELECTORS } from './selectors.js'

export function buildGetAgentStatusScript(
  selectors?: SelectorSet,
  pendingQuestion?: string,
): string {
  const loadingSelectors = selectors?.LOADING ?? SELECTORS.LOADING
  const findProseBody = buildFindProseJS()
  return `(function() {
    var status = "idle";
    var steps = [];
    var currentStep = "";
    var response = "";
    var hasStopButton = false;
    var hasLoadingSpinner = false;

    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.indexOf('stop') !== -1 || label.indexOf('cancel') !== -1) { hasStopButton = true; break; }
      // Unrelated SVG rectangles (e.g. Expand pane) are not stop controls.
    }

    var spinSelectors = ${JSON.stringify([...loadingSelectors])};
    for (var s = 0; s < spinSelectors.length; s++) {
      if (document.querySelector(spinSelectors[s])) { hasLoadingSpinner = true; break; }
    }

    var bodyText = document.body ? document.body.innerText : '';
    var workingPatterns = ['Working', 'Searching', 'Reviewing sources', 'Preparing to assist', 'Clicking', 'Typing:', 'Navigating to', 'Reading', 'Analyzing', 'Ricerca', 'Analisi', 'Preparazione', 'Digitando', 'Navigazione', 'Lettura'];
    var hasWorkingText = false;
    for (var w = 0; w < workingPatterns.length; w++) {
      if (bodyText.indexOf(workingPatterns[w]) !== -1) { hasWorkingText = true; break; }
    }

    var stepPatterns = [/Preparing to assist[^\\n]*/g, /Clicking[^\\n]*/g, /Typing:[^\\n]*/g, /Navigating to[^\\n]*/g, /Reading[^\\n]*/g, /Searching[^\\n]*/g, /Found[^\\n]*/g];
    var seenSteps = {};
    for (var sp = 0; sp < stepPatterns.length; sp++) {
      var matches = bodyText.match(stepPatterns[sp]);
      if (matches) { for (var m = 0; m < matches.length; m++) { var step = matches[m].trim(); if (step && !seenSteps[step]) { seenSteps[step] = true; steps.push(step); currentStep = step; } } }
    }

    ${findProseBody}
    var bindingError = '';
    var answerIndex = results.length - 1;
    var question = ${JSON.stringify(pendingQuestion ?? '')};
    if (question) {
      // biome-ignore lint/suspicious/noUselessEscapeInString: escape survives the generated browser script
      var normalize = function(text) { return (text || '').replace(/\s+/g, ' ').trim(); };
      var turns = document.querySelectorAll('main [data-renderer="lm"]');
      var anchor = null;
      var latestQuestion = null;
      for (var t = 0; t < turns.length; t++) {
        var turn = turns[t];
        // Answer renderers contain prose; question renderers do not.
        if (turn.matches('[class*="prose"]') || turn.querySelector('[class*="prose"]')) continue;
        latestQuestion = turn;
        // Rich-text rendering changes links and spacing; require a unique, long literal
        // prefix of the submitted prompt rather than full rendered-text equality.
        var submitted = normalize(question);
        var rendered = normalize(turn.innerText);
        var prefix = submitted.slice(0, Math.min(64, submitted.length));
        if (rendered === submitted || (prefix.length >= 48 && rendered.indexOf(prefix) === 0)) {
          if (anchor) { bindingError = 'Ambiguous submitted question prefix'; }
          anchor = turn;
        }
      }
      if (bindingError || !anchor || anchor !== latestQuestion) {
        answerIndex = -1;
        bindingError = bindingError || 'Submitted question not found as latest conversation turn';
      } else {
        answerIndex = -1;
        for (var a = 0; a < resultElements.length; a++) {
          var owner = resultElements[a].closest('[data-renderer="lm"]');
          if (owner && owner !== anchor && (anchor.compareDocumentPosition(owner) & 4)) answerIndex = a;
        }
      }
    }
    if (answerIndex >= 0) {
      response = results[answerIndex];
      response = response.replace(/View All/g, '').replace(/Show more/g, '').replace(/Ask a follow-up/g, '').replace(/\\d+ sources/g, '');
      if (response.length > 48000) response = response.substring(0, 48000) + String.fromCharCode(10) + "[MCP response truncated at 48000 chars]";
    }

    if (hasStopButton || hasLoadingSpinner) status = "working";
    else if (answerIndex >= 0) status = "completed";

    return JSON.stringify({ status: status, steps: steps, currentStep: currentStep, response: response, hasStopButton: hasStopButton, hasLoadingSpinner: hasLoadingSpinner, proseCount: results.length, bindingError: bindingError });
  })()`
}
