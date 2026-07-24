import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  signal,
} from '@angular/core';
import { CommonModule }       from '@angular/common';
import { FormsModule }        from '@angular/forms';
import { ChatMessage, ChatSession, AvailableModel, VoiceState } from '../models/chat.models';
import { ChatService }        from '../services/chat.service';
import { ChatHistoryService } from '../services/chat-history.service';
import { VoiceInputService }  from '../services/voice-input.service';
import { MarkdownPipe }       from '../pipes/markdown.pipe';

const CHAR_WARN_LIMIT  = 3000;
const CHAR_MAX_LIMIT   = 4000;
const DEFAULT_MODEL    = 'openai/gpt-4o-mini';
const INITIAL_MSG: ChatMessage = {
  role: 'assistant',
  content: 'Hello! I\'m **Tatva-E-Seva**, your virtual assistant at TatvaTech. Ask me anything! To query office details (timings, canteen menu, team desks, etc.), start your question with `/office`.',
};

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesEnd')  private messagesEnd?:  ElementRef<HTMLDivElement>;
  @ViewChild('textareaEl')   private textareaEl?:   ElementRef<HTMLTextAreaElement>;
  @ViewChild('sidebarEl')    private sidebarEl?:    ElementRef<HTMLElement>;

  // ─── Chat state ─────────────────────────────────────────────────
  readonly messages = signal<ChatMessage[]>([INITIAL_MSG]);

  draft           = '';
  isLoading       = false;
  isStreaming     = false;
  streamingContent = '';
  streamTokenCount = 0;
  errorMessage    = '';

  // ─── Sidebar state ──────────────────────────────────────────────
  sidebarOpen     = false;
  currentSession: ChatSession | null = null;

  // ─── Model selector ─────────────────────────────────────────────
  availableModels = signal<AvailableModel[]>([
    { id: DEFAULT_MODEL, name: 'GPT-4o Mini' },
  ]);
  selectedModel   = signal(DEFAULT_MODEL);
  modelDropOpen   = false;

  // ─── Prompt history navigation ──────────────────────────────────
  private promptHistory: string[] = [];
  private promptHistoryIdx = -1;

  // ─── Char counter (getters so they re-evaluate on every CD cycle) ─────────
  get charWarn(): boolean      { return this.draft.length >= CHAR_WARN_LIMIT; }
  get charOverLimit(): boolean { return this.draft.length >  CHAR_MAX_LIMIT;  }

  readonly CHAR_WARN_LIMIT = CHAR_WARN_LIMIT;
  readonly CHAR_MAX_LIMIT  = CHAR_MAX_LIMIT;

  // ─── Voice ──────────────────────────────────────────────────────
  readonly VoiceState = VoiceState;

  // ─── Sidebar sessions ───────────────────────────────────────────
  get sessions()        { return this.historyService.sessions; }
  get canCancel()       { return this.chatService.canCancel; }
  get voiceState()      { return this.voiceService.voiceState; }
  get interimTranscript(){ return this.voiceService.interimTranscript; }
  get isVoiceSupported(){ return this.voiceService.isSupported; }

  constructor(
    private readonly chatService:    ChatService,
    private readonly historyService: ChatHistoryService,
    private readonly voiceService:   VoiceInputService,
    private readonly cdRef:          ChangeDetectorRef,
    private readonly ngZone:         NgZone,
  ) {
    // Whenever a final voice transcript arrives, append it to draft
    effect(() => {
      const final = this.voiceService.finalTranscript();
      if (final) {
        this.ngZone.run(() => {
          this.draft += (this.draft.length > 0 && !this.draft.endsWith(' ') ? ' ' : '') + final;
          this.autoGrowTextarea();
        });
      }
    });
  }

  ngOnInit(): void {
    // Start sidebar open on desktop, closed on mobile
    this.sidebarOpen = typeof window !== 'undefined' ? window.innerWidth > 768 : false;

    // Load models from backend
    this.chatService.getAvailableModels().subscribe({
      next: (models) => {
        if (models.length > 0) {
          this.availableModels.set(models);
        }
      },
      error: () => { /* keep fallback list */ },
    });

    // Restore draft from sessionStorage
    const savedDraft = sessionStorage.getItem('chat_draft');
    if (savedDraft) {
      this.draft = savedDraft;
    }

    // Load the latest session if available, otherwise start fresh (lazy creation)
    const list = this.sessions();
    if (list.length > 0) {
      this.switchSession(list[0]);
    } else {
      this.newChat();
    }
  }

  ngOnDestroy(): void {
    this.chatService.cancelStream();
    if (this.voiceService.isListening) {
      this.voiceService.stopListening();
    }
    this.saveDraft();
  }

  // ─── Sending ────────────────────────────────────────────────────

  sendMessage(): void {
    const content = this.draft.trim();
    if (!content || this.isLoading || this.isStreaming || this.charOverLimit) return;

    // Track in prompt history for ↑/↓ navigation
    this.promptHistory.unshift(content);
    this.promptHistoryIdx = -1;

    const nextMessages: ChatMessage[] = [
      ...this.messages(),
      { role: 'user', content },
    ];
    this.messages.set(nextMessages);
    this.draft = '';
    this.errorMessage = '';
    sessionStorage.removeItem('chat_draft');
    this.scrollToBottom();
    this.resetTextareaHeight();

    if (this.voiceService.isListening) {
      this.voiceService.stopListening();
    }

    // Save to current session (create on the fly if this is the first message)
    if (!this.currentSession) {
      this.currentSession = this.historyService.createSession(this.selectedModel());
    }
    this.currentSession.messages = nextMessages;
    this.historyService.autoTitle(this.currentSession);
    this.startStream(nextMessages);
  }

  private async startStream(messages: ChatMessage[]): Promise<void> {
    this.isStreaming      = true;
    this.isLoading        = true;
    this.streamingContent = '';
    this.streamTokenCount = 0;

    try {
      await this.ngZone.runOutsideAngular(async () => {
        const gen = this.chatService.streamMessage({
          messages,
          model: this.selectedModel(),
        });

        for await (const chunk of gen) {
          this.ngZone.run(() => {
            this.streamingContent += chunk;
            this.streamTokenCount++;
            this.isLoading = false;
            this.scrollToBottom();
          });
        }
      });

      // Stream finished — commit to messages
      this.ngZone.run(() => {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: this.streamingContent,
        };
        this.messages.update(msgs => [...msgs, assistantMsg]);

        // Save completed exchange to session
        if (!this.currentSession) {
          this.currentSession = this.historyService.createSession(this.selectedModel());
        }
        this.currentSession.messages = this.messages();
        this.historyService.saveSession(this.currentSession);

        this.streamingContent = '';
        this.isStreaming       = false;
        this.isLoading         = false;
        this.streamTokenCount  = 0;
        this.scrollToBottom();
      });
    } catch (err: unknown) {
      this.ngZone.run(() => {
        this.isStreaming      = false;
        this.isLoading        = false;
        this.streamingContent = '';
        this.streamTokenCount = 0;
        this.errorMessage =
          err instanceof Error
            ? err.message
            : 'Something went wrong while talking to the assistant.';
      });
    }
  }

  stopStreaming(): void {
    this.chatService.cancelStream();
    // Commit whatever we have so far
    if (this.streamingContent) {
      this.messages.update(msgs => [
        ...msgs,
        { role: 'assistant', content: this.streamingContent + ' *(stopped)*' },
      ]);
      if (!this.currentSession) {
        this.currentSession = this.historyService.createSession(this.selectedModel());
      }
      this.currentSession.messages = this.messages();
      this.historyService.saveSession(this.currentSession);
    }
    this.streamingContent = '';
    this.isStreaming       = false;
    this.isLoading         = false;
    this.streamTokenCount  = 0;
  }

  // ─── Keyboard handling ──────────────────────────────────────────

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
      return;
    }

    // ↑ / ↓ — navigate prompt history (only when textarea is empty or at history entry)
    if (event.key === 'ArrowUp' && this.draft === '') {
      event.preventDefault();
      this.navigatePromptHistory(1);
      return;
    }
    if (event.key === 'ArrowDown' && this.promptHistoryIdx >= 0) {
      event.preventDefault();
      this.navigatePromptHistory(-1);
      return;
    }
  }

  private navigatePromptHistory(dir: 1 | -1): void {
    const newIdx = this.promptHistoryIdx + dir;
    if (newIdx < 0) {
      this.promptHistoryIdx = -1;
      this.draft = '';
      return;
    }
    if (newIdx >= this.promptHistory.length) return;
    this.promptHistoryIdx = newIdx;
    this.draft = this.promptHistory[newIdx];
    setTimeout(() => {
      const el = this.textareaEl?.nativeElement;
      if (el) el.selectionStart = el.selectionEnd = el.value.length;
    });
  }

  onInput(event: Event): void {
    this.autoGrowTextarea();
    this.saveDraft();
  }

  private autoGrowTextarea(): void {
    const el = this.textareaEl?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  private resetTextareaHeight(): void {
    const el = this.textareaEl?.nativeElement;
    if (el) el.style.height = '52px';
  }

  private saveDraft(): void {
    if (this.draft) {
      sessionStorage.setItem('chat_draft', this.draft);
    } else {
      sessionStorage.removeItem('chat_draft');
    }
  }

  // ─── Model selector ─────────────────────────────────────────────

  selectModel(model: AvailableModel): void {
    this.selectedModel.set(model.id);
    this.modelDropOpen = false;
    // Update current session's model
    if (this.currentSession) {
      this.currentSession.model = model.id;
      this.historyService.saveSession(this.currentSession);
    }
  }

  get selectedModelName(): string {
    return this.availableModels().find(m => m.id === this.selectedModel())?.name
        ?? this.selectedModel();
  }

  get isFreshChat(): boolean {
    return this.messages().length <= 1;
  }

  useSuggestion(text: string): void {
    this.draft = text;
    this.sendMessage();
  }

  // ─── Session management ─────────────────────────────────────────

  newChat(): void {
    this.currentSession = null;
    this.messages.set([{ ...INITIAL_MSG }]);
    this.draft = '';
    this.errorMessage = '';
    this.promptHistory = [];
    this.promptHistoryIdx = -1;
    this.closeSidebarOnMobile();
    this.resetTextareaHeight();
  }

  switchSession(session: ChatSession): void {
    this.currentSession = session;
    this.messages.set(session.messages.length > 0 ? [...session.messages] : [{ ...INITIAL_MSG }]);
    this.selectedModel.set(session.model ?? DEFAULT_MODEL);
    this.draft = '';
    this.closeSidebarOnMobile();
    this.scrollToBottom();
  }

  deleteSession(id: string, event: Event): void {
    event.stopPropagation();
    this.historyService.deleteSession(id);
    if (this.currentSession?.id === id) {
      const list = this.sessions();
      if (list.length > 0) {
        this.switchSession(list[0]);
      } else {
        this.newChat();
      }
    }
  }

  exportSession(session: ChatSession, event: Event): void {
    event.stopPropagation();
    this.historyService.exportSession(session);
  }

  clearAllHistory(): void {
    this.historyService.clearAll();
    this.newChat();
  }

  relativeTime(date: string): string {
    return this.historyService.relativeTime(date);
  }

  // ─── Voice input ────────────────────────────────────────────────

  toggleVoice(): void {
    this.voiceService.toggleListening();
  }

  // ─── Copy to clipboard ──────────────────────────────────────────

  async copyMessage(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
    } catch { /* ignore */ }
  }

  // ─── Misc ───────────────────────────────────────────────────────

  trackByIndex(index: number): number { return index; }

  private scrollToBottom(): void {
    setTimeout(() => {
      this.messagesEnd?.nativeElement.scrollIntoView({ behavior: 'smooth' });
    }, 20);
  }

  private closeSidebarOnMobile(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      this.sidebarOpen = false;
    }
  }
}
