import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newOpaqueToken = () => randomBytes(32).toString('base64url');