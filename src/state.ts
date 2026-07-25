/**
 * PawPad's branch-safe state model.
 *
 * Unlike the OpenClaw implementation, Pi stores snapshots in the details of
 * each PawPad tool result. The active session branch is the persistence key.
 */

import {
  assertPawPadStateWithinLimits,
  MAX_TASK_BLOCKERS,
  MAX_TASK_CONTENT_CHARS,
  MAX_TASK_DESCRIPTION_CHARS,
  MAX_TASK_ID_CHARS,
  MAX_TASKS,
} from "./limits.js";

export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskPriority = "high" | "medium" | "low";
export type PawPadAction = "read" | "write" | "append";

export interface Task {
  id: string;
  content: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  blockedBy?: string[];
}

export interface PawPadState {
  tasks: Task[];
  notes: string;
  updatedAt: string;
}

export interface PawPadToolDetails {
  version: 1;
  action: PawPadAction;
  /** Complete state snapshot used for branch replay. */
  state: PawPadState;
  warnings?: string[];
}

export const EMPTY_STATE: PawPadState = Object.freeze({
  tasks: [],
  notes: "",
  updatedAt: "",
});

const VALID_STATUSES = new Set<string>(["pending", "in_progress", "completed"]);
const VALID_PRIORITIES = new Set<string>(["high", "medium", "low"]);

export function validateTask(task: unknown, index: number): Task {
  if (!task || typeof task !== "object") {
    throw new Error(`Task at index ${index} is not an object`);
  }

  const value = task as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error(`Task at index ${index}: id must be a non-empty string`);
  }
  if (value.id.length > MAX_TASK_ID_CHARS) {
    throw new Error(`Task at index ${index}: id must be at most ${MAX_TASK_ID_CHARS} characters`);
  }
  if (typeof value.content !== "string" || value.content.trim() === "") {
    throw new Error(`Task at index ${index}: content must be a non-empty string`);
  }
  if (value.content.length > MAX_TASK_CONTENT_CHARS) {
    throw new Error(
      `Task at index ${index}: content must be at most ${MAX_TASK_CONTENT_CHARS} characters`,
    );
  }
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status)) {
    throw new Error(
      `Task at index ${index}: status must be pending|in_progress|completed`,
    );
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`Task at index ${index}: description must be a string`);
  }
  if (
    typeof value.description === "string" &&
    value.description.length > MAX_TASK_DESCRIPTION_CHARS
  ) {
    throw new Error(
      `Task at index ${index}: description must be at most ${MAX_TASK_DESCRIPTION_CHARS} characters`,
    );
  }
  if (
    value.priority !== undefined &&
    (typeof value.priority !== "string" || !VALID_PRIORITIES.has(value.priority))
  ) {
    throw new Error(`Task at index ${index}: priority must be high|medium|low`);
  }
  if (
    value.blockedBy !== undefined &&
    (!Array.isArray(value.blockedBy) ||
      !value.blockedBy.every((blockedBy) => typeof blockedBy === "string"))
  ) {
    throw new Error(`Task at index ${index}: blockedBy must be an array of strings`);
  }
  if (Array.isArray(value.blockedBy) && value.blockedBy.length > MAX_TASK_BLOCKERS) {
    throw new Error(
      `Task at index ${index}: blockedBy must contain at most ${MAX_TASK_BLOCKERS} ids`,
    );
  }
  if (
    Array.isArray(value.blockedBy) &&
    value.blockedBy.some(
      (blockedBy) =>
        typeof blockedBy === "string" &&
        (blockedBy.trim() === "" || blockedBy.length > MAX_TASK_ID_CHARS),
    )
  ) {
    throw new Error(
      `Task at index ${index}: blockedBy ids must be non-empty and at most ${MAX_TASK_ID_CHARS} characters`,
    );
  }

  return {
    id: value.id,
    content: value.content,
    status: value.status as TaskStatus,
    ...(value.description !== undefined
      ? { description: value.description }
      : {}),
    ...(value.priority !== undefined
      ? { priority: value.priority as TaskPriority }
      : {}),
    ...(value.blockedBy !== undefined
      ? { blockedBy: [...(value.blockedBy as string[])] }
      : {}),
  };
}

export function validateTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) {
    throw new Error("tasks must be an array");
  }
  if (tasks.length > MAX_TASKS) {
    throw new Error(`tasks must contain at most ${MAX_TASKS} items`);
  }

  const validated = tasks.map((task, index) => validateTask(task, index));
  const seen = new Set<string>();
  for (const task of validated) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id: "${task.id}"`);
    }
    seen.add(task.id);
  }
  return validated;
}

export function cloneState(state: PawPadState): PawPadState {
  return {
    tasks: state.tasks.map((task) => ({
      ...task,
      ...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}),
    })),
    notes: state.notes,
    updatedAt: state.updatedAt,
  };
}

function parseStateSnapshot(value: unknown): PawPadState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.notes !== "string") return undefined;
  if (typeof snapshot.updatedAt !== "string") return undefined;

  try {
    const state = {
      tasks: validateTasks(snapshot.tasks),
      notes: snapshot.notes,
      updatedAt: snapshot.updatedAt,
    };
    assertPawPadStateWithinLimits(state);
    return state;
  } catch {
    return undefined;
  }
}

/** Parse a complete snapshot from a PawPad tool-result details object. */
export function parsePawPadToolDetails(value: unknown): PawPadState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const details = value as Record<string, unknown>;
  if (details.version !== 1) return undefined;
  return parseStateSnapshot(details.state);
}

/**
 * Rebuild state from the active branch. Entries from sibling branches are not
 * considered because getBranch() returns only the selected root-to-leaf path.
 */
export function reconstructStateFromBranch(
  entries: readonly {
    type: string;
    message?: {
      role?: string;
      toolName?: string;
      details?: unknown;
    };
  }[],
): PawPadState {
  let state = cloneState(EMPTY_STATE);

  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "toolResult") {
      continue;
    }
    const toolName = entry.message.toolName;
    if (toolName !== "pawpad_tasks" && toolName !== "pawpad_note") {
      continue;
    }

    const snapshot = parsePawPadToolDetails(entry.message.details);
    if (snapshot) state = snapshot;
  }

  return state;
}
