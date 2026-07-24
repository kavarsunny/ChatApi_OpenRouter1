export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
}

export interface ChatResponse {
  reply: string;
}

// ─── Chat Session (localStorage history) ───────────────────────

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: string;      // ISO date string
  updatedAt: string;      // ISO date string
}

// ─── Available Model (from GET /api/chat/models) ───────────────

export interface AvailableModel {
  id: string;
  name: string;
  description?: string;
}

// ─── Voice Input State ─────────────────────────────────────────

export enum VoiceState {
  Idle        = 'idle',
  Listening   = 'listening',
  Processing  = 'processing',
  Unsupported = 'unsupported',
}
