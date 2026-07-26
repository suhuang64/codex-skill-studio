import DOMPurify from 'dompurify';
import { marked } from 'marked';
export function renderMarkdown(markdown) {
    const rendered = marked.parse(markdown, {
        async: false,
        gfm: true,
        breaks: false,
    });
    const sanitized = DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true },
    });
    const template = document.createElement('template');
    template.innerHTML = sanitized;
    template.content.querySelectorAll('a').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });
    return template.innerHTML;
}
