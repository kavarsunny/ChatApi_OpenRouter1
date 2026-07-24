import { Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * A lightweight Markdown → Safe HTML pipe.
 * Handles: code blocks, inline code, bold, italic, headers, lists, line breaks.
 * Uses Angular's DomSanitizer to safely bind HTML.
 */
@Pipe({ name: 'markdown', standalone: true, pure: true })
export class MarkdownPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const html = this.parse(value);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private parse(text: string): string {
    // Escape HTML entities first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks: ```lang\n...\n```
    html = html.replace(
      /```(\w*)\n?([\s\S]*?)```/g,
      (_, lang, code) =>
        `<pre class="code-block"><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`
    );

    // Inline code: `...`
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Headers: ### ## #
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Unordered lists: lines starting with - or *
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    // Ordered lists: 1. 2. etc.
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr/>');

    // Line breaks: two newlines → paragraph break
    html = html.replace(/\n{2,}/g, '</p><p>');

    // Single newline → <br>
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = `<p>${html}</p>`;

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<(?:h[123]|ul|pre|hr)[^>]*>)/g, '$1');
    html = html.replace(/(<\/(?:h[123]|ul|pre|hr)>)<\/p>/g, '$1');

    return html;
  }
}
