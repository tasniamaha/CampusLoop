// Unit tests only (vitest.config.ts setupFiles); the e2e config does not load this.
//
// Test.createTestingModule(...).compile() lazily imports @nestjs/platform-express. In a fresh
// Vitest worker that cold load (Express and its middleware) ran inside beforeEach and counted
// against the 5 s test timeout: up to about 1.2 s per spec under load, and timeouts on a busy
// machine. Setup files run before the file's tests and outside any test timeout, so loading it
// here makes compile() take milliseconds in every spec that builds a Nest module, current or future.
import '@nestjs/platform-express';
