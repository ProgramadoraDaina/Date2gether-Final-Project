import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateAdmissionSettingsDto {
  @IsOptional()
  @IsBoolean()
  waitingRoomEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  entryLocked?: boolean;
}

export class AdmissionDecisionDto {
  @IsIn(['admitted', 'rejected'])
  decision: 'admitted' | 'rejected';
}
