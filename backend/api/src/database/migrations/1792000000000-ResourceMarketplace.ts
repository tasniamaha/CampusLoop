import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResourceMarketplace1792000000000 implements MigrationInterface {
  name = 'ResourceMarketplace1792000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE resource_categories (
        id varchar(36) NOT NULL,
        name varchar(60) NOT NULL,
        slug varchar(60) NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX UQ_resource_categories_name (name),
        UNIQUE INDEX UQ_resource_categories_slug (slug),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await q.query(`
      INSERT INTO resource_categories (id, name, slug) VALUES
        (UUID(), 'Books', 'books'),
        (UUID(), 'Calculators', 'calculators'),
        (UUID(), 'Lab accessories', 'lab-accessories'),
        (UUID(), 'Electronics', 'electronics'),
        (UUID(), 'Other', 'other')
    `);

    // "condition" is a reserved word in MySQL, so the column is itemCondition.
    await q.query(`
      ALTER TABLE resources
        ADD categoryId varchar(36) NULL,
        ADD itemCondition enum ('new','good','fair','worn') NOT NULL DEFAULT 'good',
        ADD borrowingRules text NULL,
        ADD maxLoanDays int NOT NULL DEFAULT 7,
        ADD pickupLocation varchar(150) NULL,
        ADD deletedAt datetime(6) NULL
    `);

    // Backfill: old free-text category -> matching slug, else 'other'.
    await q.query(`
      UPDATE resources r SET r.categoryId = COALESCE(
        (SELECT c.id FROM resource_categories c
          WHERE c.slug IN (LOWER(r.category), CONCAT(LOWER(r.category), 's')) LIMIT 1),
        (SELECT c2.id FROM resource_categories c2 WHERE c2.slug = 'other')
      )
    `);

    await q.query(`ALTER TABLE resources MODIFY categoryId varchar(36) NOT NULL`);

    await q.query(`
      ALTER TABLE resources
        DROP INDEX IDX_resources_category_listed,
        DROP COLUMN category,
        ADD INDEX IDX_resources_categoryId_listed (categoryId, isListed),
        ADD INDEX IDX_resources_listed_created (isListed, createdAt),
        ADD CONSTRAINT FK_resources_category FOREIGN KEY (categoryId)
          REFERENCES resource_categories(id) ON DELETE RESTRICT
    `);

    await q.query(`
      CREATE TABLE resource_images (
        id varchar(36) NOT NULL,
        resourceId varchar(36) NOT NULL,
        storageKey varchar(80) NOT NULL,
        mimeType varchar(50) NOT NULL,
        sizeBytes int NOT NULL,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX UQ_resource_images_storageKey (storageKey),
        INDEX IDX_resource_images_resource_sort (resourceId, sortOrder),
        PRIMARY KEY (id),
        CONSTRAINT FK_resource_images_resource FOREIGN KEY (resourceId)
          REFERENCES resources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TABLE resource_favorites (
        userId varchar(36) NOT NULL,
        resourceId varchar(36) NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX IDX_resource_favorites_resource (resourceId),
        PRIMARY KEY (userId, resourceId),
        CONSTRAINT FK_resource_favorites_user FOREIGN KEY (userId)
          REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT FK_resource_favorites_resource FOREIGN KEY (resourceId)
          REFERENCES resources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  // down() is lossy for categories (restores the slug as free text). Untested.
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE resource_favorites`);
    await q.query(`DROP TABLE resource_images`);
    await q.query(`ALTER TABLE resources ADD category varchar(50) NOT NULL DEFAULT 'other'`);
    await q.query(`UPDATE resources r JOIN resource_categories c ON c.id = r.categoryId SET r.category = c.slug`);
    await q.query(`ALTER TABLE resources DROP FOREIGN KEY FK_resources_category`);
    await q.query(`
      ALTER TABLE resources
        DROP INDEX IDX_resources_categoryId_listed,
        DROP INDEX IDX_resources_listed_created,
        DROP COLUMN categoryId,
        DROP COLUMN itemCondition,
        DROP COLUMN borrowingRules,
        DROP COLUMN maxLoanDays,
        DROP COLUMN pickupLocation,
        DROP COLUMN deletedAt,
        ADD INDEX IDX_resources_category_listed (category, isListed)
    `);
    await q.query(`DROP TABLE resource_categories`);
  }
}