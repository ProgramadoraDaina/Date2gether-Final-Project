// Provider-agnostic contract: swapping Gemini for another model only touches the
// implementation that is bound to AI_TEXT_GENERATOR.
export interface AiTextRequest {
  systemInstruction: string;
  prompt: string;
}

export interface AiTextResult {
  text: string;
  model: string;
}

export interface AiTextGenerator {
  generate(request: AiTextRequest): Promise<AiTextResult>;
}

export const AI_TEXT_GENERATOR = Symbol('AI_TEXT_GENERATOR');

export type AiFailureReason = 'not_configured' | 'quota' | 'unavailable' | 'blocked';

// Carries only a coarse reason to callers; the original SDK error stays in `cause`
// (server-side logs only, it must never reach the HTTP response).
export class AiGenerationError extends Error {
  constructor(
    readonly reason: AiFailureReason,
    readonly cause?: unknown,
  ) {
    super(`AI generation failed: ${reason}`);
    this.name = 'AiGenerationError';
  }
}
