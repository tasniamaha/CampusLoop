/**
 * Captures environment variables as they were set for this command, BEFORE anything loads .env.
 * Import this first: ES modules evaluate their imports in order, and data-source.ts imports
 * dotenv/config, which fills in variables that are missing from the environment.
 */
export const explicitEnv = Object.freeze({
  DB_DATABASE: process.env.DB_DATABASE?.trim() || null,
});
