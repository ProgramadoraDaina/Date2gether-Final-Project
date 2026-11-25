import { IsIn, IsOptional } from 'class-validator';

export const SUMMARY_LANGUAGES = ['es', 'en'] as const;
export type SummaryLanguage = (typeof SUMMARY_LANGUAGES)[number];

export class GenerateSummaryDto {
  @IsOptional()
  @IsIn(SUMMARY_LANGUAGES)
  language?: SummaryLanguage;
}
