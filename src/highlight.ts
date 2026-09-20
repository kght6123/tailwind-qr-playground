import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';

// Keep the native textarea responsible for editing, selection and IME input.
export function highlightEditor(editor: HTMLTextAreaElement, language: 'markup' | 'css') {
  const backdrop = document.createElement('pre');
  backdrop.className = 'code-highlight';
  backdrop.setAttribute('aria-hidden', 'true');
  editor.before(backdrop);
  editor.classList.add('highlighted');
  const sync = () => {
    if (editor.clientWidth) {
      backdrop.style.width = `${editor.clientWidth}px`;
      backdrop.style.height = `${editor.clientHeight}px`;
    }
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
  };
  const update = () => {
    backdrop.innerHTML = Prism.highlight(editor.value + '\n', Prism.languages[language], language);
    sync();
  };
  editor.addEventListener('input', update);
  editor.addEventListener('scroll', sync);
  new ResizeObserver(sync).observe(editor);
  update();
  return update;
}
