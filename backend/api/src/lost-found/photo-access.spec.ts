import { describe, expect, it } from 'vitest';
import { canViewPhotos, type PhotoSubject, type PhotoViewer } from './photo-access.js';
import { LostFoundStatus, LostFoundType } from './entities/lost-found-report.entity.js';
import { UserRole } from '../users/entities/user.entity.js';

const report = (type: LostFoundType, status = LostFoundStatus.OPEN): PhotoSubject => ({
  reporterId: 'reporter',
  campus: 'north',
  type,
  status,
});
const viewer = (id: string, role: UserRole, campus = 'north'): PhotoViewer => ({ id, role, campus });

const reporter = viewer('reporter', UserRole.STUDENT);
const student = viewer('student', UserRole.STUDENT);
const otherCampusStudent = viewer('student2', UserRole.STUDENT, 'south');
const moderator = viewer('mod', UserRole.MODERATOR);
const otherCampusModerator = viewer('mod2', UserRole.MODERATOR, 'south');
const admin = viewer('admin', UserRole.ADMIN, 'south');

// [report, viewer, expected]
const cases: Array<[string, PhotoSubject, PhotoViewer, boolean]> = [
  ['open lost: reporter', report(LostFoundType.LOST), reporter, true],
  ['open lost: same-campus student', report(LostFoundType.LOST), student, true],
  ['open lost: other-campus student', report(LostFoundType.LOST), otherCampusStudent, false],
  ['open found: reporter', report(LostFoundType.FOUND), reporter, true],
  ['open found: same-campus student (incl. claimants)', report(LostFoundType.FOUND), student, false],
  ['open found: same-campus moderator', report(LostFoundType.FOUND), moderator, true],
  ['open found: other-campus moderator', report(LostFoundType.FOUND), otherCampusModerator, false],
  ['open found: admin on another campus', report(LostFoundType.FOUND), admin, true],
  ['resolved lost: reporter', report(LostFoundType.LOST, LostFoundStatus.RESOLVED), reporter, true],
  ['resolved lost: same-campus student', report(LostFoundType.LOST, LostFoundStatus.RESOLVED), student, false],
  ['resolved lost: same-campus moderator', report(LostFoundType.LOST, LostFoundStatus.RESOLVED), moderator, true],
  ['resolved lost: other-campus moderator', report(LostFoundType.LOST, LostFoundStatus.RESOLVED), otherCampusModerator, false],
  ['resolved found: admin', report(LostFoundType.FOUND, LostFoundStatus.RESOLVED), admin, true],
  ['resolved found: same-campus student', report(LostFoundType.FOUND, LostFoundStatus.RESOLVED), student, false],
];

describe('canViewPhotos', () => {
  it.each(cases)('%s', (_label, subject, who, expected) => {
    expect(canViewPhotos(subject, who)).toBe(expected);
  });

  it('treats an unknown role like a student', () => {
    expect(canViewPhotos(report(LostFoundType.FOUND), viewer('x', 'superuser' as UserRole))).toBe(false);
  });
});
