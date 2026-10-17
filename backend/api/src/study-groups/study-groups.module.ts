import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity.js';
import { StudyGroup } from './entities/study-group.entity.js';
import { StudyGroupMember } from './entities/study-group-member.entity.js';
import { StudyGroupsController } from './study-groups.controller.js';
import { StudyGroupsService } from './study-groups.service.js';
@Module({ imports: [TypeOrmModule.forFeature([StudyGroup, StudyGroupMember, User])], controllers: [StudyGroupsController], providers: [StudyGroupsService], exports: [StudyGroupsService] })
export class StudyGroupsModule {}
