import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity.js';

export default new DataSource({
  type: 'mariadb',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [User],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});