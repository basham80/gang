import { Buffer } from 'buffer';

const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: { env: Record<string, string | undefined>; browser?: boolean };
};

if (!g.Buffer) {
  g.Buffer = Buffer;
}
if (!g.global) {
  g.global = globalThis;
}
if (!g.process) {
  g.process = { env: {}, browser: true };
}
