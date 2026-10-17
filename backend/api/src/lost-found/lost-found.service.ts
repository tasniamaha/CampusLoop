import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { CreateLostFoundReportDto } from './dto/create-lost-found-report.dto.js';
import { ListLostFoundQueryDto } from './dto/list-lost-found-query.dto.js';
import {
  LostFoundReport,
  LostFoundStatus,
  LostFoundType,
} from './entities/lost-found-report.entity.js';

const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');
const publicReport = (report: LostFoundReport) => ({
  id: report.id,
  type: report.type,
  title: report.title,
  description: report.description,
  category: report.category,
  location: report.location,
  itemDate: report.itemDate,
  imageUrl: report.imageUrl,
  status: report.status,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

@Injectable()
export class LostFoundService {
  constructor(
    @InjectRepository(LostFoundReport)
    private readonly reports: Repository<LostFoundReport>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private async getCampus(userId: string): Promise<string> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, campus: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    return user.campus;
  }

  async list(userId: string, query: ListLostFoundQueryDto) {
    const campus = await this.getCampus(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.reports.findAndCount({
      where: {
        campus,
        status: LostFoundStatus.OPEN,
        ...(query.type ? { type: query.type } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => ({ ...publicReport(row), isMine: row.reporterId === userId })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async create(userId: string, dto: CreateLostFoundReportDto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.itemDate) || Number.isNaN(Date.parse(`${dto.itemDate}T00:00:00Z`)) || new Date(`${dto.itemDate}T00:00:00Z`).toISOString().slice(0, 10) !== dto.itemDate) {
      throw new BadRequestException('Item date must be a valid calendar date');
    }
    const campus = await this.getCampus(userId);
    const itemDateMs = Date.parse(`${dto.itemDate}T00:00:00Z`);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    if (itemDateMs > todayUtc.getTime()) {
      throw new BadRequestException('Item date cannot be in the future');
    }
    const report = this.reports.create({
      reporterId: userId,
      campus,
      type: dto.type,
      title: cleanText(dto.title),
      description: dto.description.trim(),
      category: cleanText(dto.category),
      location: cleanText(dto.location),
      itemDate: dto.itemDate,
      imageUrl: dto.imageUrl?.trim() || null,
      status: LostFoundStatus.OPEN,
      resolvedAt: null,
    });
    return publicReport(await this.reports.save(report));
  }

  async matches(id: string, userId: string) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({ where: { id, campus, status: LostFoundStatus.OPEN } });
    if (!report) throw new NotFoundException('Open lost-and-found report not found');

    const oppositeType = report.type === LostFoundType.LOST
      ? LostFoundType.FOUND
      : LostFoundType.LOST;
    const candidates = await this.reports.find({
      where: {
        campus,
        type: oppositeType,
        status: LostFoundStatus.OPEN,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const words = (value: string) => new Set(
      value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3),
    );
    const reportWords = words(`${report.title} ${report.description}`);
    const reportDate = new Date(`${report.itemDate}T00:00:00Z`).getTime();

    return candidates
      .filter((candidate) => candidate.id !== report.id && candidate.reporterId !== userId)
      .map((candidate) => {
        const candidateWords = words(`${candidate.title} ${candidate.description}`);
        const sharedWords = [...reportWords].filter((word) => candidateWords.has(word)).length;
        const sameLocation = candidate.location.trim().toLocaleLowerCase() === report.location.trim().toLocaleLowerCase();
        const candidateDate = new Date(`${candidate.itemDate}T00:00:00Z`).getTime();
        const daysApart = Math.abs(reportDate - candidateDate) / 86_400_000;
        const sameCategory = candidate.category.trim().toLocaleLowerCase() === report.category.trim().toLocaleLowerCase();
        const score = Math.min(sharedWords * 15, 35)
          + (sameLocation ? 30 : 0)
          + (sameCategory ? 20 : 0)
          + (daysApart <= 1 ? 15 : daysApart <= 3 ? 8 : 0);
        const reasons = [
          ...(sharedWords ? ['Similar description keywords'] : []),
          ...(sameLocation ? ['Same reported location'] : []),
          ...(sameCategory ? ['Same category'] : []),
          ...(daysApart <= 3 ? ['Dates are within 3 days'] : []),
        ];
        return { report: publicReport(candidate), score, reasons };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime());
  }

  async resolve(id: string, userId: string) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({ where: { id, campus } });
    if (!report) throw new NotFoundException('Lost-and-found report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException('Only the person who created this report can resolve it');
    }
    if (report.status !== LostFoundStatus.RESOLVED) {
      report.status = LostFoundStatus.RESOLVED;
      report.resolvedAt = new Date();
      await this.reports.save(report);
    }
    return publicReport(report);
  }
}
