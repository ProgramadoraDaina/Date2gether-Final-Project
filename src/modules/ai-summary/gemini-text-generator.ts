import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import {
  AiGenerationError,
  type AiTextGenerator,
  type AiTextRequest,
  type AiTextResult,
} from './ai-text-generator';

// Current non-deprecated Flash-Lite model with a free tier (Gemini API pricing page).
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const REQUEST_TIMEOUT_MS = 30_000;
// Generous headroom over the expected ~300-token summary: a truncated summary is rejected
// (see below), so a limit that is too tight turns into user-visible failures.
const MAX_OUTPUT_TOKENS = 2048;
// The model stopped for a content-policy reason: retrying the same transcript will not help.
const BLOCKED_FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.RECITATION,
  FinishReason.SPII,
]);

@Injectable()
export class GeminiTextGenerator implements AiTextGenerator {
  private readonly logger = new Logger(GeminiTextGenerator.name);
  private client?: GoogleGenAI;

  constructor(private readonly config: ConfigService) {}

  async generate({ systemInstruction, prompt }: AiTextRequest): Promise<AiTextResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    // The app boots without a key; the failure surfaces per request instead.
    if (!apiKey) throw new AiGenerationError('not_configured');
    const model = this.config.get<string>('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
    this.client ??= new GoogleGenAI({ apiKey });

    let text: string | undefined;
    let finishReason: FinishReason | undefined;
    try {
      const response = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.3,
          abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      });
      text = response.text?.trim();
      finishReason = response.candidates?.[0]?.finishReason;
    } catch (error) {
      const isQuota = error instanceof ApiError && error.status === 429;
      // Log status/name only: SDK errors may echo request details.
      this.logger.warn(
        `Gemini request failed (${error instanceof ApiError ? error.status : (error as Error)?.name})`,
      );
      throw new AiGenerationError(isQuota ? 'quota' : 'unavailable', error);
    }

    if (finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
      this.logger.warn(`Gemini stopped generating (${finishReason})`);
      throw new AiGenerationError('blocked');
    }
    if (text && finishReason !== FinishReason.STOP) {
      // MAX_TOKENS (or any other non-STOP end) means the text is incomplete: never store it.
      this.logger.warn(`Gemini returned an incomplete response (${finishReason ?? 'no finish reason'})`);
      throw new AiGenerationError('unavailable');
    }
    if (!text) {
      this.logger.warn('Gemini returned no text (blocked or empty response)');
      throw new AiGenerationError('blocked');
    }
    return { text, model };
  }
}
