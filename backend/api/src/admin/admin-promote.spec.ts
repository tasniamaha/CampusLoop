import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RefreshTokenService } from '../auth/refresh-token.service.js';
import { canonicalEmail } from '../common/email.js';

describe('AdminUsersService.promoteBySystem (admin:promote CLI)', () => {
  it('looks the account up by canonical email, exactly as login does', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const dataSource = { getRepository: () => ({ findOne }) } as unknown as DataSource;
    const service = new AdminUsersService(dataSource, new AuditService(), {} as RefreshTokenService);

    const input = '  Some.User+Tag@Example.COM ';
    await expect(service.promoteBySystem(input)).rejects.toBeInstanceOf(NotFoundException);
    // canonicalEmail is the function login uses; its Gmail dot/+tag rules are covered in email.spec.ts.
    expect(findOne).toHaveBeenCalledWith({ where: { emailCanonical: canonicalEmail(input) }, select: { id: true } });
  });

  it('is not reachable over HTTP: no controller calls it', () => {
    const root = join(import.meta.dirname, '..');
    const controllers = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.controller.ts'))
      .map((file) => readFileSync(join(root, file), 'utf8'));
    expect(controllers.length).toBeGreaterThan(5);
    for (const source of controllers) expect(source).not.toContain('promoteBySystem');
  });
});
