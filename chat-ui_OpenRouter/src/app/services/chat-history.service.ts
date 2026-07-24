import { Injectable, signal } from '@angular/core';
import { ChatMessage, ChatSession } from '../models/chat.models';

const STORAGE_KEY = 'chat_sessions_v1';

@Injectable({ providedIn: 'root' })
export class ChatHistoryService {
  /** All sessions in localStorage */
  readonly sessions = signal<ChatSession[]>(this.loadSessions());

  // ─── Session CRUD ──────────────────────────────────────────────

  /** Create a brand-new empty session and persist it */
  createSession(model: string, title = 'New Chat'): ChatSession {
    const session: ChatSession = {
      id:        crypto.randomUUID(),
      title,
      model,
      messages:  [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.update(list => [session, ...list]);
    this.persist();
    return session;
  }

  /** Save (upsert) a session — updates existing or inserts new */
  saveSession(session: ChatSession): void {
    session.updatedAt = new Date().toISOString();
    this.sessions.update(list => {
      const idx = list.findIndex(s => s.id === session.id);
      if (idx === -1) return [session, ...list];
      const updated = [...list];
      updated[idx]  = { ...session };
      return updated;
    });
    this.persist();
  }

  /** Auto-title the session from its first user message */
  autoTitle(session: ChatSession): void {
    const firstUser = session.messages.find(m => m.role === 'user');
    if (firstUser && session.title === 'New Chat') {
      session.title = firstUser.content.slice(0, 50).trim() +
                      (firstUser.content.length > 50 ? '…' : '');
      this.saveSession(session);
    }
  }

  /** Rename a session */
  renameSession(id: string, title: string): void {
    this.sessions.update(list =>
      list.map(s => s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s)
    );
    this.persist();
  }

  /** Delete a session by id */
  deleteSession(id: string): void {
    this.sessions.update(list => list.filter(s => s.id !== id));
    this.persist();
  }

  /** Delete all sessions */
  clearAll(): void {
    this.sessions.set([]);
    this.persist();
  }

  /** Export session as a beautiful HTML file download */
  exportSession(session: ChatSession): void {
    const htmlContent = this.generateHtmlExport(session);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Tatva-E-Seva-${session.title.slice(0, 30).replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private generateHtmlExport(session: ChatSession): string {
    const messagesHtml = session.messages.map(m => {
      const isUser = m.role === 'user';
      return `
        <div class="message ${isUser ? 'user' : 'ai'}">
          <div class="avatar">${isUser ? 'U' : 'AI'}</div>
          <div class="content">
            <div class="role">${isUser ? 'You' : 'Tatva-E-Seva'}</div>
            <div class="text">${this.escapeHtml(m.content)}</div>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(session.title)} - Tatva-E-Seva</title>
  <style>
    :root {
      --bg: #f9f8f6;
      --surface: #ffffff;
      --text: #191919;
      --text-muted: #5c5b56;
      --user-bg: #f0ede9;
      --accent: #d97757;
      --border: rgba(0,0,0,0.08);
    }
    body {
      margin: 0; padding: 2rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .header {
      max-width: 800px;
      margin: 0 auto 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      text-align: center;
    }
    .header h1 { margin: 0 0 0.5rem; font-family: 'Georgia', serif; font-size: 2.2rem; color: var(--accent); }
    .header p { margin: 0; color: var(--text-muted); font-size: 0.95rem; }
    .chat-container {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.8rem;
    }
    .message {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }
    .message.user { flex-direction: row-reverse; }
    .avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; flex-shrink: 0; font-size: 0.9rem;
    }
    .message.ai .avatar { background: var(--accent); color: white; }
    .message.user .avatar { background: var(--user-bg); color: var(--text); border: 1px solid var(--border); }
    .content { max-width: 80%; }
    .message.user .content {
      background: var(--user-bg);
      padding: 0.85rem 1.25rem;
      border-radius: 18px 18px 4px 18px;
      border: 1px solid var(--border);
    }
    .role { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.3rem; color: var(--text-muted); }
    .message.user .role { display: none; }
    .text { white-space: pre-wrap; word-break: break-word; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Tatva-E-Seva</h1>
    <p>${this.escapeHtml(session.title)} &middot; Exported on ${new Date().toLocaleDateString()}</p>
  </div>
  <div class="chat-container">
    ${messagesHtml}
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Persistence ───────────────────────────────────────────────

  private loadSessions(): ChatSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ChatSession[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions()));
    } catch {
      // localStorage may be full or unavailable (private mode)
    }
  }

  /** Format relative time label for the sidebar */
  relativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);

    if (mins  < 1)  return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  < 7)  return `${days}d ago`;
    return new Date(isoDate).toLocaleDateString();
  }
}
