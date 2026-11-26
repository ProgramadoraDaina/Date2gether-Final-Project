import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';

const { generateContent, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContent = vi.fn();
  return {
    generateContent,
    GoogleGenAIMock: vi.fn(function () {
      return { models: { generateContent } };
    }),
  };
});

// Keep the real ApiError class (the generator uses instanceof); fake only the client.
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: GoogleGenAIMock,
}));

import { ApiError } from '@google/genai';
import { AiGenerationError } from './ai-text-generator';
import { DEFAULT_GEMINI_MODEL, GeminiTextGenerator } from './gemini-text-generator';

function setup(env: Record<string, string | undefined>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new GeminiTextGenerator(config);
}

const request = { systemInstruction: 'Summarize.', prompt: 'hello' };

describe('GeminiTextGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails with not_configured, without building a client, when there is no API key', async () => {
    const generator = setup({});
    await expect(generator.generate(request)).rejects.toMatchObject({ reason: 'not_configured' });
    expect(GoogleGenAIMock).not.toHaveBeenCalled();
  });

  it('calls the configured model with the system instruction and returns trimmed text', async () => {
    generateContent.mockResolvedValue({ text: '  A summary  ', candidates: [{ finishReason: 'STOP' }] });
    const generator = setup({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-custom' });

    await expect(generator.generate(request)).resolves.toEqual({
      text: 'A summary',
      model: 'gemini-custom',
    });

    expect(GoogleGenAIMock).toHaveBeenCalledWith({ apiKey: 'k' });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-custom',
        contents: 'hello',
        config: expect.objectContaining({ systemInstruction: 'Summarize.' }),
      }),
    );
  });

  it('uses the default model when GEMINI_MODEL is not set', async () => {
    generateContent.mockResolvedValue({ text: 'ok', candidates: [{ finishReason: 'STOP' }] });
    const result = await setup({ GEMINI_API_KEY: 'k' }).generate(request);
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('maps a 429 from Gemini to the quota reason', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'RESOURCE_EXHAUSTED', status: 429 }));
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'quota',
    });
  });

  it('maps other API and network errors to unavailable', async () => {
    generateContent.mockRejectedValueOnce(new ApiError({ message: 'boom', status: 500 }));
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    generateContent.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toBeInstanceOf(
      AiGenerationError,
    );
  });

  it('treats an empty or blocked response as blocked', async () => {
    generateContent.mockResolvedValue({ text: undefined });
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'blocked',
    });
  });

  it('treats a truncated response (MAX_TOKENS) as unavailable instead of returning partial text', async () => {
    generateContent.mockResolvedValue({
      text: 'Half a summ',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it.each(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION', 'SPII'])(
    'treats finishReason %s as blocked even when partial text exists',
    async (finishReason) => {
      generateContent.mockResolvedValue({ text: 'partial', candidates: [{ finishReason }] });
      await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
        reason: 'blocked',
      });
    },
  );

  it('does not accept text without a STOP finish reason', async () => {
    generateContent.mockResolvedValue({ text: 'text', candidates: [{ finishReason: 'OTHER' }] });
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    generateContent.mockResolvedValue({ text: 'text' });
    await expect(setup({ GEMINI_API_KEY: 'k' }).generate(request)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('asks for at least 2048 output tokens', async () => {
    generateContent.mockResolvedValue({ text: 'ok', candidates: [{ finishReason: 'STOP' }] });
    await setup({ GEMINI_API_KEY: 'k' }).generate(request);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ maxOutputTokens: 2048 }) }),
    );
  });
});
