import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('resource_categories')
export class ResourceCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  slug!: string;

  @CreateDateColumn()
  createdAt!: Date;
}