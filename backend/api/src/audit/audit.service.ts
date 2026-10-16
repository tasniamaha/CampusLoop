import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity.js';

export interface AuditEntry {
  actorId: string | null; // null = performed by the system
  action: string;         // 'resource.deleted'
  targetType: string;     // 'resource'
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

// A shallow tripwire, not a guarantee: never put credentials in audit metadata.
const SENSITIVE_KEY = /pass|token|secret|hash|authorization|cookie/i;

@Injectable()
export class AuditService {
  /** Pass the SAME manager as the action being audited, so both commit or neither does. */
  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const bad = Object.keys(entry.metadata ?? {}).find((k) => SENSITIVE_KEY.test(k));
    if (bad) throw new Error(`Audit metadata key "${bad}" looks sensitive and was refused`);
    await manager.save(
      manager.create(AuditLog, {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
      }),
    );
  }
}