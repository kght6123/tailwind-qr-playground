import DOMPurify from 'dompurify';
import runtimeUrl from '../node_modules/@tailwindcss/browser/dist/index.global.js?url';
import type { Sample } from './codec';

export function previewDocument(sample: Sample): string {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const doc = document.implementation.createHTMLDocument('Tailwind preview');
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'`;
  doc.head.prepend(policy);
  const viewport = doc.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'; doc.head.append(viewport);
  const style = doc.createElement('style'); style.type = 'text/tailwindcss';
  // Escape HTML raw-text terminators without changing the original editor source.
  style.textContent = sample.css.replace(/<\/style/gi, '<\\/style');
  doc.head.append(style);
  const script = doc.createElement('script');
  script.src = new URL(runtimeUrl, location.href).href;
  doc.head.append(script);
  doc.body.innerHTML = DOMPurify.sanitize(sample.html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'foreignObject', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'target', 'nonce', 'is'],
    ALLOW_DATA_ATTR: false,
  });
  // Serialize the nonce explicitly: DOM nonce hiding can empty the attribute
  // when outerHTML is used to construct the srcdoc document.
  return '<!doctype html>' + doc.documentElement.outerHTML.replace('<script ', `<script nonce="${nonce}" `);
}
