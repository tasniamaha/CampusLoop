import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { BorrowRequest } from '../borrow-requests/entities/borrow-request.entity.js';
import { ResourceCategory } from '../resources/entities/resource-category.entity.js';
import { ResourceImage } from '../resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../resources/entities/resource-favorite.entity.js';
export default new DataSource({
  type: 'mariadb',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
 entities: [User, Resource, BorrowRequest, ResourceCategory, ResourceImage, ResourceFavorite],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});