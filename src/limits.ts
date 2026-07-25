import { Buffer } from "node:buffer";
import { buildPawPadPrompt } from "./prompt.js";
import type { PawPadState } from "./state.js";

/** Keep each persisted snapshot and injected PawPad block comfortably below Pi's 50 KB tool limit. */
export const MAX_STATE_BYTES = 40 * 1024;
export const MAX_CONTEXT_BYTES = 40 * 1024;
export const MAX_CONTEXT_LINES = 1_500;
export const MAX_TASKS = 100;
export const MAX_TASK_ID_CHARS = 128;
export const MAX_TASK_CONTENT_CHARS = 512;
export const MAX_TASK_DESCRIPTION_CHARS = 4_096;
export const MAX_TASK_BLOCKERS = 50;
export const MAX_NOTE_INPUT_CHARS = 40_000;

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split("\n").length;
}

/** Return a user-facing limit error, or undefined when the complete state is safe to persist and inject. */
export function getPawPadStateLimitError(state: PawPadState): string | undefined {
  const serialized = JSON.stringify(state, null, 2);
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  if (serializedBytes > MAX_STATE_BYTES) {
    return `PawPad state is ${serializedBytes} bytes; the limit is ${MAX_STATE_BYTES} bytes. Condense notes or tasks and retry.`;
  }

  const prompt = buildPawPadPrompt(state);
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const promptLines = lineCount(prompt);
  if (promptBytes > MAX_CONTEXT_BYTES || promptLines > MAX_CONTEXT_LINES) {
    return `PawPad context is ${promptBytes} bytes across ${promptLines} lines; the limits are ${MAX_CONTEXT_BYTES} bytes and ${MAX_CONTEXT_LINES} lines. Condense notes or tasks and retry.`;
  }

  return undefined;
}

export function assertPawPadStateWithinLimits(state: PawPadState): void {
  const error = getPawPadStateLimitError(state);
  if (error) throw new Error(error);
}
