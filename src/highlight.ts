import { CodeJar } from 'codejar';
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';

export function createEditor(element: HTMLElement, language: 'markup' | 'css') {
  // WebKit/Chromium may insert BR nodes even in plaintext-only mode.
  // CodeJar reads textContent, so normalize them before its input handlers run.
  element.addEventListener('input', () => {
    for (const block of element.querySelectorAll('div')) {
      if (block.previousSibling) block.before('\n');
      block.replaceWith(...block.childNodes);
    }
    for (const br of element.querySelectorAll('br')) br.replaceWith('\n');
  });
  const highlight = () => {
    element.innerHTML = Prism.highlight(element.textContent || '', Prism.languages[language], language);
  };
  const jar = CodeJar(element, highlight, {
    tab: '  ', preserveIdent: true, catchTab: true, addClosing: true, history: true,
  });
  // Preserve CodeJar's multi-line insertHTML edits in WebKit as well.
  element.contentEditable = 'true';
  // Mobile keyboards and IMEs can change text without a corresponding keyup.
  let composing = false;
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    clearTimeout(timer);
    if (composing) return;
    timer = setTimeout(() => {
      if (composing) return;
      const position = document.activeElement === element ? jar.save() : undefined;
      highlight();
      if (position) jar.restore(position);
    }, 40);
  };
  element.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  element.addEventListener('compositionend', () => { composing = false; refresh(); });
  element.addEventListener('input', refresh);
  return jar;
}
