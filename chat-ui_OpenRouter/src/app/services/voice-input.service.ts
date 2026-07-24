import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { VoiceState } from '../models/chat.models';

// Web Speech API — not in default lib.dom.d.ts in older setups.
// We use `any` guards so this compiles without the optional @types package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult:  ((event: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror:   ((event: any) => void) | null;
  onend:     (() => void) | null;
  start():   void;
  stop():    void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechAPI: (new () => SpeechRecognitionType) | undefined =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

@Injectable({ providedIn: 'root' })
export class VoiceInputService implements OnDestroy {
  /** Current voice recognition state */
  readonly voiceState = signal<VoiceState>(VoiceState.Idle);

  /** Interim (in-progress) transcript shown live in the textarea */
  readonly interimTranscript = signal('');

  /** Final confirmed transcript ready to append */
  readonly finalTranscript = signal('');

  private recognition: SpeechRecognitionType | null = null;

  constructor(private readonly ngZone: NgZone) {
    if (!SpeechAPI) {
      this.voiceState.set(VoiceState.Unsupported);
      return;
    }

    this.recognition = new SpeechAPI();
    this.recognition.continuous      = true;
    this.recognition.interimResults  = true;
    this.recognition.lang            = 'en-US';
    this.recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onresult = (event: any) => {
      let interim = '';
      let final   = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      this.ngZone.run(() => {
        this.interimTranscript.set(interim);
        if (final) {
          this.finalTranscript.set(final);
        }
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      this.ngZone.run(() => {
        this.voiceState.set(VoiceState.Idle);
        this.interimTranscript.set('');
      });
    };

    this.recognition.onend = () => {
      if (this.voiceState() === VoiceState.Listening) {
        // Restart for continuous listening
        try { this.recognition?.start(); } catch { /* already started */ }
      }
    };
  }

  get isSupported(): boolean {
    return this.voiceState() !== VoiceState.Unsupported;
  }

  get isListening(): boolean {
    return this.voiceState() === VoiceState.Listening;
  }

  startListening(): void {
    if (!this.recognition || !this.isSupported) return;
    this.interimTranscript.set('');
    this.finalTranscript.set('');
    this.voiceState.set(VoiceState.Listening);
    try {
      this.recognition.start();
    } catch {
      // Already started — ignore
    }
  }

  stopListening(): string {
    if (!this.recognition) return '';
    this.voiceState.set(VoiceState.Idle);
    this.recognition.stop();
    const result = this.finalTranscript() || this.interimTranscript();
    this.interimTranscript.set('');
    this.finalTranscript.set('');
    return result;
  }

  toggleListening(): void {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  ngOnDestroy(): void {
    this.recognition?.stop();
  }
}
