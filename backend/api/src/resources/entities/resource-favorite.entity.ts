import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('resource_favorites')
export class ResourceFavorite {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  resourceId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}