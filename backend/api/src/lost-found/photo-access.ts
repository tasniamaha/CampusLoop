import { UserRole } from '../users/entities/user.entity.js';
import { LostFoundStatus, LostFoundType } from './entities/lost-found-report.entity.js';

export interface PhotoViewer {
  id: string;
  campus: string;
  /** The current role from the database, never the role claim in the access token. */
  role: UserRole | string;
}

export interface PhotoSubject {
  reporterId: string;
  campus: string;
  type: LostFoundType;
  status: LostFoundStatus;
}

/**
 * Who may see a report's photos (and its legacy imageUrl). project.md §4.4, §5.2.
 *
 * - The reporter: always.
 * - Admins: always, on any campus (as for moderation reports).
 * - Moderators: on their own campus.
 * - Everyone else, same campus only:
 *     open LOST report  -> yes (the photos help people spot the item)
 *     open FOUND report -> no  (hidden from claimants, so a photo cannot be used to fake proof)
 *     resolved report   -> no
 *
 * The only place this rule lives. Every response and the photo endpoint go through it.
 */
export function canViewPhotos(report: PhotoSubject, viewer: PhotoViewer): boolean {
  if (report.reporterId === viewer.id) return true;
  if (viewer.role === UserRole.ADMIN) return true;
  if (report.campus !== viewer.campus) return false;
  if (viewer.role === UserRole.MODERATOR) return true;
  return report.status === LostFoundStatus.OPEN && report.type === LostFoundType.LOST;
}
