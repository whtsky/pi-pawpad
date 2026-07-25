import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  assertPawPadStateWithinLimits,
  MAX_NOTE_INPUT_CHARS,
  MAX_TASK_BLOCKERS,
  MAX_TASK_CONTENT_CHARS,
  MAX_TASK_DESCRIPTION_CHARS,
  MAX_TASK_ID_CHARS,
  MAX_TASKS,
} from "./limits.js";
import {
  cloneState,
  type PawPadAction,
  type PawPadState,
  type PawPadToolDetails,
  type Task,
  validateTasks,
} from "./state.js";

export const TaskSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    maxLength: MAX_TASK_ID_CHARS,
    description: 'Unique stable short identifier (e.g. "t1", "setup-db"). Referenced by blockedBy.',
  }),
  content: Type.String({
    minLength: 1,
    maxLength: MAX_TASK_CONTENT_CHARS,
    description: "Brief task title in imperative form",
  }),
  description: Type.Optional(
    Type.String({
      maxLength: MAX_TASK_DESCRIPTION_CHARS,
      description: "Detailed description with context and acceptance criteria",
    }),
  ),
  status: StringEnum(["pending", "in_progress", "completed"] as const, {
    description: "Task status",
  }),
  priority: Type.Optional(
    StringEnum(["high", "medium", "low"] as const, {
      description: "Task priority (default: medium)",
    }),
  ),
  blockedBy: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: MAX_TASK_ID_CHARS }), {
      maxItems: MAX_TASK_BLOCKERS,
      description: "IDs of tasks that must complete before this one can start",
    }),
  ),
});

export const PawPadTasksParameters = Type.Object({
  action: StringEnum(["read", "write"] as const, {
    description: 'Action: "read" to get current tasks, or "write" to replace all tasks.',
  }),
  tasks: Type.Optional(
    Type.Array(TaskSchema, {
      maxItems: MAX_TASKS,
      description: 'Full replacement task list (required when action is "write").',
    }),
  ),
});

export const PawPadNoteParameters = Type.Object({
  action: StringEnum(["read", "write", "append"] as const, {
    description: '"read" to get notes, "write" to replace, "append" to add to end.',
  }),
  content: Type.Optional(
    Type.String({
      maxLength: MAX_NOTE_INPUT_CHARS,
      description: 'Note content (required for "write" and "append" actions).',
    }),
  ),
});

type PawPadTasksParams = Static<typeof PawPadTasksParameters>;
type PawPadNoteParams = Static<typeof PawPadNoteParameters>;

export interface PawPadToolConfig {
  warnCompletedTasks: number;
  warnNoteChars: number;
}

export interface PawPadRuntime {
  getState(): PawPadState;
  setState(state: PawPadState): void;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  stateChanged(ctx: ExtensionContext): void;
}

function textResult(
  text: string,
  action: PawPadAction,
  state: PawPadState,
  extra: { warnings?: string[] } = {},
): AgentToolResult<PawPadToolDetails> {
  const details: PawPadToolDetails = {
    version: 1,
    action,
    state: cloneState(state),
    ...(extra.warnings && extra.warnings.length > 0
      ? { warnings: [...extra.warnings] }
      : {}),
  };
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function getTaskWarnings(
  tasks: readonly Task[],
  warnThreshold: number,
): string[] {
  const completed = tasks.filter((task) => task.status === "completed").length;
  return completed > warnThreshold
    ? [
        `⚠️ ${completed} completed tasks accumulating. Consider removing finished tasks to keep the list focused.`,
      ]
    : [];
}

export function getNoteWarning(noteLength: number, warnThreshold: number): string[] {
  return noteLength > warnThreshold
    ? [`⚠️ Notes are ${noteLength} characters. Consider condensing to keep context focused.`]
    : [];
}

function getNoteWriteWarning(noteLength: number, warnThreshold: number): string[] {
  return noteLength > warnThreshold
    ? [`⚠️ Notes are ${noteLength} characters. Consider condensing.`]
    : [];
}

function getNoteAppendWarning(noteLength: number, warnThreshold: number): string[] {
  return noteLength > warnThreshold
    ? [`⚠️ Notes are now ${noteLength} characters. Consider condensing.`]
    : [];
}

function statusSummary(tasks: readonly Task[]): string {
  const counts: Partial<Record<Task["status"], number>> = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return (["in_progress", "pending", "completed"] as const)
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${status}`)
    .join(", ");
}

export function createTasksTool(
  runtime: PawPadRuntime,
  config: PawPadToolConfig,
): ToolDefinition<typeof PawPadTasksParameters, PawPadToolDetails> {
  return {
    name: "pawpad_tasks",
    label: "PawPad Tasks",
    description:
      "Persistent per-session task list that survives context compaction. " +
      'Use "read" to get current tasks, "write" to replace the full list. ' +
      "Each task has an id, content, status (pending/in_progress/completed), and optional priority, description, and blockedBy fields.",
    promptSnippet: "Read or replace the persistent PawPad task list",
    promptGuidelines: [
      "Use pawpad_tasks to keep the persistent task list current; write replaces the full list.",
    ],
    parameters: PawPadTasksParameters,
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<PawPadToolDetails>> {
      return runtime.withLock(async () => {
        const current = runtime.getState();

        if (params.action === "read") {
          if (current.tasks.length === 0) {
            return textResult("No tasks recorded yet.", "read", current);
          }
          const warnings = getTaskWarnings(current.tasks, config.warnCompletedTasks);
          const result = JSON.stringify(
            { tasks: current.tasks, updatedAt: current.updatedAt },
            null,
            2,
          );
          return textResult(
            warnings.length > 0
              ? `${result}\n\n${warnings.join("\n")}`
              : result,
            "read",
            current,
            { warnings },
          );
        }

        if (!params.tasks || !Array.isArray(params.tasks)) {
          throw new Error("tasks array is required for write action");
        }

        const validatedTasks = validateTasks(params.tasks);

        const next: PawPadState = {
          tasks: validatedTasks,
          notes: current.notes,
          updatedAt: new Date().toISOString(),
        };
        assertPawPadStateWithinLimits(next);
        runtime.setState(next);
        runtime.stateChanged(ctx);

        const warnings = getTaskWarnings(validatedTasks, config.warnCompletedTasks);
        const count = validatedTasks.length;
        const summary = statusSummary(validatedTasks);
        const message = `Tasks updated (${count} task${count === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}).`;
        return textResult(
          warnings.length > 0 ? `${message}\n\n${warnings.join("\n")}` : message,
          "write",
          next,
          { warnings },
        );
      });
    },
  };
}

export function createNoteTool(
  runtime: PawPadRuntime,
  config: PawPadToolConfig,
): ToolDefinition<typeof PawPadNoteParameters, PawPadToolDetails> {
  return {
    name: "pawpad_note",
    label: "PawPad Note",
    description:
      "Persistent per-session scratchpad that survives context compaction. " +
      'Use "read" to get notes, "write" to replace, "append" to add. ' +
      "Proactively record durable decisions, constraints, user preferences, verified findings, " +
      "and non-obvious rationale that future turns must retain. Keep notes concise; do not duplicate task status or transient progress.",
    promptSnippet: "Record or retrieve durable session decisions and context",
    promptGuidelines: [
      "Use pawpad_note proactively: immediately append a concise note after a durable decision, constraint, user preference, verified finding, or non-obvious rationale that future turns must retain. Do not wait for compaction, and do not duplicate task status or transient progress in notes.",
    ],
    parameters: PawPadNoteParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<PawPadToolDetails>> {
      return runtime.withLock(async () => {
        const current = runtime.getState();

        if (params.action === "read") {
          if (!current.notes) return textResult("No notes recorded yet.", "read", current);
          const warnings = getNoteWarning(current.notes.length, config.warnNoteChars);
          const warningText = warnings.length > 0
            ? `\n\n${warnings.join("\n")}`
            : "";
          return textResult(
            current.notes + warningText,
            "read",
            current,
            { warnings },
          );
        }

        if (params.content == null) {
          throw new Error(`content is required for ${params.action} action`);
        }

        const nextNotes = params.action === "write"
          ? params.content
          : current.notes
            ? `${current.notes.trimEnd()}\n\n${params.content}`
            : params.content;
        const next: PawPadState = {
          tasks: current.tasks,
          notes: nextNotes,
          // updatedAt is the task-list timestamp, matching OpenClaw's tasks.json.
          updatedAt: current.updatedAt,
        };
        assertPawPadStateWithinLimits(next);
        runtime.setState(next);
        runtime.stateChanged(ctx);

        const warnings = params.action === "write"
          ? getNoteWriteWarning(nextNotes.length, config.warnNoteChars)
          : getNoteAppendWarning(nextNotes.length, config.warnNoteChars);
        if (params.action === "write") {
          return textResult(
            `Notes updated.${warnings.length > 0 ? `\n${warnings.join("\n")}` : ""}`,
            "write",
            next,
            { warnings },
          );
        }

        return textResult(
          `Notes appended.${warnings.length > 0 ? `\n${warnings.join("\n")}` : ""}`,
          "append",
          next,
          { warnings },
        );
      });
    },
  };
}
