const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
]);

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|math|template|form|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const HTML_TAG = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/giu;
const HTML_ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

export function sanitizeReportHtml(input) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return sanitizeWithDom(input);
  }
  const withoutComments = String(input ?? '').replace(/<!--[\s\S]*?-->/gu, '');
  const withoutDangerousBlocks = withoutComments.replace(DROP_WITH_CONTENT, '');
  return withoutDangerousBlocks.replace(HTML_TAG, (source, rawTag) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (/^<\s*\//u.test(source)) return `</${tag}>`;
    if (tag !== 'a') return `<${tag}>`;

    const attributes = source.slice(source.indexOf(rawTag) + rawTag.length, source.lastIndexOf('>'));
    let href = null;
    let title = null;
    for (const match of attributes.matchAll(HTML_ATTRIBUTE)) {
      const name = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      if (name === 'href' && isSafeHref(value)) href = value;
      if (name === 'title') title = value;
    }
    const safeHref = href === null ? '' : ` href="${escapeAttribute(href)}"`;
    const safeTitle = title === null ? '' : ` title="${escapeAttribute(title)}"`;
    return `<a${safeHref}${safeTitle}>`;
  });
}

function sanitizeWithDom(input) {
  const template = document.createElement('template');
  template.innerHTML = String(input ?? '');
  const output = document.createElement('div');
  appendSafeChildren(template.content, output);
  return output.innerHTML;
}

function appendSafeChildren(source, destination) {
  for (const node of source.childNodes) {
    if (node.nodeType === 3) {
      destination.appendChild(document.createTextNode(node.textContent || ''));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    if (isDropWithContentTag(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      appendSafeChildren(node, destination);
      continue;
    }
    const clean = document.createElement(tag);
    if (tag === 'a') {
      const href = node.getAttribute('href');
      const title = node.getAttribute('title');
      if (href && isSafeHref(href)) clean.setAttribute('href', href);
      if (title) clean.setAttribute('title', title);
    }
    appendSafeChildren(node, clean);
    destination.appendChild(clean);
  }
}

function isDropWithContentTag(tag) {
  return ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'button', 'textarea', 'select'].includes(tag);
}

function isSafeHref(value) {
  const normalized = String(value).trim().replace(/[\u0000-\u0020\u007f]+/gu, '');
  return /^(?:https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/iu.test(normalized);
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}
