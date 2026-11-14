/**
 * Runs one setup step and logs how long it took, or how and when it failed. If it is still running
 * after `slowMs`, that is logged at once, so a hang names its step instead of ending only in
 * "Hook timed out" or "Test timed out". Used where full e2e runs have failed intermittently.
 * Writes to stderr directly: Vitest captures console calls and did not print them for these runs.
 */
const log = (line: string) => process.stderr.write(`${line}\n`);

export async function timedStep<T>(spec: string, step: string, fn: () => Promise<T>, slowMs = 5_000): Promise<T> {
  const label = `[setup] ${spec} > ${step}`;
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  const slow = setTimeout(() => log(`${label}: still running after ${slowMs} ms`), slowMs);
  slow.unref();
  try {
    const result = await fn();
    log(`${label}: ok in ${elapsed()} ms`);
    return result;
  } catch (err) {
    log(`${label}: FAILED after ${elapsed()} ms: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    throw err;
  } finally {
    clearTimeout(slow);
  }
}
