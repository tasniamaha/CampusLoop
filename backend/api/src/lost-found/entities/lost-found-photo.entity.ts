import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A photo attached to a lost-and-found report. The file lives in the 'lost-found' image folder
 * (LOST_FOUND_UPLOAD_DIR) under `storageKey` and is only ever served through the access-checked
 * GET /lost-found/:id/photos/:photoId endpoint (see canViewPhotos).
 *
 * Lifecycle of the file:
 * - Upload: the sanitised file is written first, then the row is inserted in a transaction; if the
 *   insert fails the file is deleted again.
 * - Delete photo: the row is deleted in a transaction, then the file is deleted.
 * - Delete report: the API has no endpoint that deletes reports (resolving is the end state). If a
 *   report row is removed by the database (ON DELETE CASCADE from users), its photo rows cascade
 *   with it but the files stay on disk. Cleaning those up belongs to the account-deletion and data
 *   retention policy, which is still an open decision (project.md §13.6).
 */
@Entity('lost_found_photos')
@Index('IDX_lost_found_photos_report_order', ['reportId', 'sortOrder'])
export class LostFoundPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  reportId!: string;

  // Server-generated file name. Never derived from user input.
  @Column({ type: 'varchar', length: 80, unique: true })
  storageKey!: string;

  @Column({ type: 'varchar', length: 50 })
  mimeType!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
