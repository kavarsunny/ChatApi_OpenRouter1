import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AvailableModel, ChatRequest, ChatResponse } from '../models/chat.models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly apiUrl = environment.apiUrl;

  /** Current active AbortController for the in-flight stream */
  private abortController?: AbortController;

  /** Whether a stream is currently cancellable */
  readonly canCancel = signal(false);

  constructor(private readonly http: HttpClient) {}

  // ─── Non-streaming ──────────────────────────────────────────────

  /** Non-streaming — returns full reply at once */
  sendMessage(request: ChatRequest): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(this.apiUrl, request);
  }

  // ─── Streaming ─────────────────────────────────────────────────

  /**
   * Streaming — calls POST /api/chat/stream and yields each SSE chunk
   * via an async generator. Caller iterates with `for await`.
   * Supports cancellation via cancelStream().
   */
  async *streamMessage(request: ChatRequest): AsyncGenerator<string> {
    this.abortController = new AbortController();
    this.canCancel.set(true);

    try {
      const response = await fetch(`${this.apiUrl}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(`Stream error ${response.status}: ${errorText}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by "\n\n"
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;

            const payload = line.slice(6); // strip "data: "

            if (payload === '[DONE]') return;

            if (payload.startsWith('[ERROR]')) {
              throw new Error(payload.slice(8));
            }

            yield payload;
          }
        }
      }
    } catch (err) {
      // Swallow AbortError — user intentionally cancelled
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    } finally {
      this.canCancel.set(false);
      this.abortController = undefined;
    }
  }

  /** Cancel the current in-flight stream */
  cancelStream(): void {
    this.abortController?.abort();
    this.canCancel.set(false);
  }

  // ─── Model Discovery ───────────────────────────────────────────

  /** Fetches available models from the backend */
  getAvailableModels(): Observable<AvailableModel[]> {
    return this.http.get<AvailableModel[]>(`${this.apiUrl}/models`);
  }

  // ─── Company Knowledge Base ─────────────────────────────────────

  /** Fetches the configured company details / knowledge base content */
  getKnowledge(): Observable<{ content: string }> {
    const url = this.apiUrl.replace('/chat', '/knowledge');
    return this.http.get<{ content: string }>(url);
  }

  /** Replaces the company details / knowledge base content */
  updateKnowledge(content: string): Observable<void> {
    const url = this.apiUrl.replace('/chat', '/knowledge');
    return this.http.put<void>(url, { content });
  }
}
