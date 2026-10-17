import { IsIn } from 'class-validator';
import { StudyGroupMemberStatus } from '../entities/study-group-member.entity.js';
export class ReviewStudyGroupMemberDto {
  @IsIn([StudyGroupMemberStatus.ACTIVE, StudyGroupMemberStatus.REJECTED]) status!: StudyGroupMemberStatus;
}
