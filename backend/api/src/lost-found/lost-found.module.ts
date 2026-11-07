import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity.js';
import { LostFoundReport } from './entities/lost-found-report.entity.js';
import { LostFoundClaim } from './entities/lost-found-claim.entity.js';
import { LostFoundPhoto } from './entities/lost-found-photo.entity.js';
import { ImagesModule } from '../images/images.module.js';
import { LostFoundController } from './lost-found.controller.js';
import { LostFoundService } from './lost-found.service.js';
import { ReportsModule } from '../reports/reports.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([LostFoundReport, LostFoundClaim, LostFoundPhoto, User]),
    ReportsModule,
    ImagesModule,
  ],
  controllers: [LostFoundController],
  providers: [LostFoundService],
  exports: [LostFoundService],
})
export class LostFoundModule {}
