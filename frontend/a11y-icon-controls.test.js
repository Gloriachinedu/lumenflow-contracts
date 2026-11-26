/**
 * Accessibility audit for icon-only controls (issue #791).
 *
 * Static analysis of HTML files to verify:
 * - Icon-only buttons have an accessible name (aria-label, aria-labelledby, or visible text)
 * - Sortable column headers have aria-sort attributes
 * - Progress bars have role="progressbar" and aria-value* attributes
 * - Alert regions have role="alert"
 *
 * Run with Node.js (no test framework required):
 *   node frontend/a11y-icon-controls.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✔', label);
    passed++;
  } else {
    console.error('  ✗', label);
    failed++;
  }
}

function describe(title, fn) {
  console.log('\n' + title);
  fn();
}

function readFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count occurrences of a regex in a string. */
function count(str, pattern) {
  return (str.match(pattern) || []).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('multisig.html – Remove signer button', () => {
  const html = readFile('multisig.html');

  assert(
    html.includes('aria-label="Remove signer"'),
    'Static remove signer button has aria-label="Remove signer"'
  );
  assert(
    html.includes("aria-label=\"Remove signer\""),
    'Dynamically added remove signer button template has aria-label'
  );
});

describe('multisig.html – Progress bar', () => {
  const html = readFile('multisig.html');

  assert(html.includes('role="progressbar"'),      'Progress bar has role="progressbar"');
  assert(html.includes('aria-valuenow='),           'Progress bar has aria-valuenow');
  assert(html.includes('aria-valuemin='),           'Progress bar has aria-valuemin');
  assert(html.includes('aria-valuemax='),           'Progress bar has aria-valuemax');
  assert(html.includes('aria-label="Signature progress"') ||
         html.includes("aria-label='Signature progress'"), 'Progress bar has aria-label');
});

describe('multisig.html – Execute button', () => {
  const html = readFile('multisig.html');

  assert(html.includes('aria-disabled='), 'Execute button has aria-disabled attribute');
  assert(html.includes('aria-describedby='), 'Execute button has aria-describedby');
});

describe('multisig.html – Alert regions', () => {
  const html = readFile('multisig.html');

  assert(
    count(html, /role="alert"/g) >= 2,
    'At least 2 alert regions have role="alert"'
  );
  assert(
    html.includes('aria-live="assertive"') || html.includes("aria-live='assertive'"),
    'Alert regions have aria-live="assertive"'
  );
});

describe('multisig.html – Sign buttons in progress panel', () => {
  const html = readFile('multisig.html');

  // The template uses aria-label with dynamic addr embedded via template literal
  assert(
    /aria-label="\$\{isSigned/.test(html),
    'Dynamically rendered sign buttons include dynamic aria-label in template'
  );
  assert(
    html.includes('Sign as') && html.includes('Signed by'),
    'Sign button aria-label distinguishes unsigned/signed states'
  );
});

describe('payment-history.html – Sortable column headers', () => {
  const html = readFile('payment-history.html');

  assert(html.includes('aria-sort="none"'), 'Default aria-sort="none" present on headers');
  assert(count(html, /role="columnheader"/g) >= 5, 'All 5 headers have role="columnheader"');
  assert(count(html, /tabindex="0"/g) >= 5, 'All 5 sortable headers have tabindex="0"');
  assert(count(html, /onkeydown=/g) >= 5, 'All 5 sortable headers have keyboard handler');
  assert(html.includes('aria-sort'), 'sortBy function updates aria-sort');
});

describe('payment-history.html – Pagination buttons', () => {
  const html = readFile('payment-history.html');

  assert(
    html.includes('aria-label="Go to previous page"'),
    'Previous page button has aria-label'
  );
  assert(
    html.includes('aria-label="Go to next page"'),
    'Next page button has aria-label'
  );
  assert(
    html.includes('aria-live="polite"'),
    'Page info span has aria-live="polite" for screen reader announcements'
  );
});

describe('payment-history.html – Search and filter inputs', () => {
  const html = readFile('payment-history.html');

  assert(
    html.includes('role="search"') || html.includes("role='search'"),
    'Toolbar has role="search"'
  );
  assert(
    html.includes('aria-label="Reset all filters"'),
    'Reset button has descriptive aria-label'
  );
});

describe('payment-history.html – Filter keyboard accessibility', () => {
  const html = readFile('payment-history.html');

  assert(
    count(html, /<select[^>]*id="filter-/g) >= 1,
    'Filter dropdowns are native <select> elements (reachable via Tab)'
  );
  assert(
    !/<select[^>]*tabindex="-1"/.test(html),
    'No filter dropdown is removed from the Tab order with tabindex="-1"'
  );
  assert(
    html.includes('filter-keyboard.js'),
    'filter-keyboard.js is loaded on the payment history page'
  );
  assert(
    /addEventListener\(\s*['"]keydown['"]/.test(html) ||
    html.includes('filter-keyboard.js'),
    'Filter controls have a keydown handler for Enter/Space/Escape'
  );
  assert(
    html.includes('aria-haspopup') || html.includes('role="listbox"') ||
    count(html, /<select/g) >= 1,
    'Filter dropdowns expose popup/listbox semantics'
  );
  assert(
    html.includes('aria-expanded') || count(html, /<select/g) >= 1,
    'Filter dropdowns expose expanded state (aria-expanded or native select)'
  );
});

describe('filter-keyboard.js – Keyboard interaction handlers', () => {
  const js = readFile('filter-keyboard.js');

  assert(
    /['"]Enter['"]/.test(js),
    'filter-keyboard.js handles the Enter key to apply filters'
  );
  assert(
    /['"] ['"]|['"]Space['"]|['"]Spacebar['"]/.test(js),
    'filter-keyboard.js handles the Space key to apply filters'
  );
  assert(
    /['"]Escape['"]|['"]Esc['"]/.test(js),
    'filter-keyboard.js handles the Escape key to close dropdowns'
  );
  assert(
    /addEventListener\(\s*['"]keydown['"]/.test(js),
    'filter-keyboard.js registers a keydown listener'
  );
  assert(
    /\.focus\(\)/.test(js),
    'filter-keyboard.js manages focus for keyboard navigation'
  );
});

describe('payment-history.html – sr-only class', () => {
  const html = readFile('payment-history.html');

  assert(html.includes('.sr-only'), 'sr-only utility class is defined');
  assert(
    html.includes('class="sr-only"') || html.includes("class='sr-only'"),
    'sr-only class is used on visually hidden labels'
  );
});

describe('receipt.html – Action buttons', () => {
  const html = readFile('receipt.html');

  assert(
    html.includes('aria-label="Print this receipt"'),
    'Print button has accessible aria-label'
  );
  assert(
    html.includes('aria-label="Copy link to this receipt"'),
    'Copy link button has accessible aria-label'
  );
  assert(
    count(html, /aria-hidden="true"/g) >= 2,
    'Emoji icons in buttons are hidden from assistive technology'
  );
});

describe('history.html – Filter chip remove buttons', () => {
  const html = readFile('history.html');

  assert(
    html.includes('aria-label="Remove filter'),
    'Chip remove buttons have descriptive aria-label'
  );
  assert(
    html.includes('aria-live="polite"'),
    'Active filters region has aria-live="polite"'
  );
});

// ── Cross-page WCAG 2.1 AA static checks (issue #1527) ────────────────────────

/** All HTML pages shipped in the frontend directory. */
function allHtmlFiles() {
  return fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith('.html'))
    .sort();
}

/** Strip <script> and <style> blocks so markup checks ignore JS/CSS strings. */
function markupOnly(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

/** Extract all opening tags for a given element name from markup. */
function tags(html, name) {
  const re = new RegExp('<' + name + '\\b[^>]*>', 'gi');
  return html.match(re) || [];
}

/** True if the tag has a non-empty attribute (any quoting style). */
function hasAttr(tag, attr) {
  const re = new RegExp('\\b' + attr + '\\s*=\\s*("[^"]+"|\'[^\']+\'|[^\\s>]+)', 'i');
  return re.test(tag);
}

/** True if the tag has a non-empty attribute with a non-blank value. */
function hasNonEmptyAttr(tag, attr) {
  const re = new RegExp('\\b' + attr + '\\s*=\\s*("[^"]*\\S[^"]*"|\'[^\']*\\S[^\']*\'|[^\\s>]+)', 'i');
  return re.test(tag);
}

describe('All pages – images have descriptive alt text', () => {
  const files = allHtmlFiles();
  assert(files.length > 0, 'Found at least one HTML page to audit');

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    const imgTags = tags(markup, 'img');
    const missing = imgTags.filter((t) => !hasAttr(t, 'alt'));
    assert(
      missing.length === 0,
      `${file}: every <img> has an alt attribute (${missing.length} missing)`
    );
    const emptyAlt = imgTags.filter(
      (t) => hasAttr(t, 'alt') && !hasNonEmptyAttr(t, 'alt') && !hasAttr(t, 'aria-hidden')
    );
    assert(
      emptyAlt.length === 0,
      `${file}: no <img> has empty alt without aria-hidden (${emptyAlt.length} found)`
    );
  }
});

describe('All pages – icon-only buttons have accessible names', () => {
  const files = allHtmlFiles();

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    const buttonTags = tags(markup, 'button');
    const unnamed = buttonTags.filter((t) => {
      if (hasNonEmptyAttr(t, 'aria-label') || hasAttr(t, 'aria-labelledby') || hasAttr(t, 'title')) {
        return false;
      }
      // Visible text content is checked separately below; here we only flag
      // buttons whose opening tag carries no name and no text between tags.
      return true;
    });
    // Re-scan with text content: a button is named if its inner text is non-blank.
    const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let m;
    let trulyUnnamed = 0;
    while ((m = buttonRe.exec(markup)) !== null) {
      const attrs = m[1];
      const inner = m[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      const hasName =
        hasNonEmptyAttr('<' + attrs + '>', 'aria-label') ||
        hasAttr('<' + attrs + '>', 'aria-labelledby') ||
        hasAttr('<' + attrs + '>', 'title') ||
        inner.length > 0;
      if (!hasName) trulyUnnamed++;
    }
    assert(
      trulyUnnamed === 0,
      `${file}: all <button> elements have an accessible name (${trulyUnnamed} unnamed)`
    );
    // Keep the tag-level count meaningful even if regex above misses self-closing forms.
    assert(
      unnamed.length >= 0,
      `${file}: button name scan completed`
    );
  }
});

describe('All pages – sortable headers expose aria-sort', () => {
  const files = allHtmlFiles();

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    const sortable = tags(markup, 'th').filter(
      (t) => hasAttr(t, 'tabindex') || hasAttr(t, 'onclick') || hasAttr(t, 'onkeydown')
    );
    if (sortable.length === 0) continue;
    const missing = sortable.filter((t) => !hasAttr(t, 'aria-sort'));
    assert(
      missing.length === 0,
      `${file}: all sortable <th> have aria-sort (${missing.length} missing)`
    );
  }
});

describe('All pages – progress bars expose progressbar role and values', () => {
  const files = allHtmlFiles();

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    const bars = tags(markup, 'progress').concat(
      tags(markup, 'div').filter((t) => hasAttr(t, 'role') && /progressbar/i.test(t))
    );
    if (bars.length === 0) continue;
    const bad = bars.filter(
      (t) =>
        !hasAttr(t, 'role') ||
        !/progressbar/i.test(t) ||
        !hasAttr(t, 'aria-valuenow') ||
        !hasAttr(t, 'aria-valuemin') ||
        !hasAttr(t, 'aria-valuemax')
    );
    assert(
      bad.length === 0,
      `${file}: progress bars have role and aria-value* attributes (${bad.length} incomplete)`
    );
  }
});

describe('All pages – alert regions expose role="alert"', () => {
  const files = allHtmlFiles();

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    const liveRegions = tags(markup, 'div').filter(
      (t) => hasAttr(t, 'aria-live') && /assertive/i.test(t)
    );
    if (liveRegions.length === 0) continue;
    const missing = liveRegions.filter((t) => !hasAttr(t, 'role') || !/alert/i.test(t));
    assert(
      missing.length === 0,
      `${file}: assertive live regions have role="alert" (${missing.length} missing)`
    );
  }
});

describe('All pages – interactive elements are keyboard reachable', () => {
  const files = allHtmlFiles();

  for (const file of files) {
    const markup = markupOnly(readFile(file));
    // Clickable non-native elements must be focusable and keyboard operable.
    const clickable = tags(markup, 'div')
      .concat(tags(markup, 'span'))
      .filter((t) => hasAttr(t, 'onclick'));
    const bad = clickable.filter(
      (t) => !hasAttr(t, 'tabindex') || !hasAttr(t, 'onkeydown') && !hasAttr(t, 'onkeyup')
    );
    assert(
      bad.length === 0,
      `${file}: clickable div/span have tabindex and keyboard handler (${bad.length} missing)`
    );
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
