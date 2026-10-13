import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('resource_images')
export class ResourceImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  resourceId!: string;

  // Server-generated file name. Never derived from user input.
  @Column({ type: 'varchar', length: 80, unique: true })
  storageKey!: string;

  @Column({ type: 'varchar', length: 50 })
  mimeType!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}