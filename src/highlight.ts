import { registerTemplate } from '@webcoder49/code-input';
import PrismTemplate from '@webcoder49/code-input/templates/prism.mjs';
import '@webcoder49/code-input/code-input.css';
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';

registerTemplate('prism', new PrismTemplate(Prism));
