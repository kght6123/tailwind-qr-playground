declare module '@webcoder49/code-input' {
  export class CodeInput extends HTMLElement {
    value: string;
    textareaElement: HTMLTextAreaElement | null;
  }
  export function registerTemplate(name: string, template: object): void;
}
declare module '@webcoder49/code-input/templates/prism.mjs' {
  export default class PrismTemplate {
    constructor(prism: typeof import('prismjs'));
  }
}
