import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import type { PawPadState, Task } from "./state.js";
import {
  DEFAULT_WIDGET_PREFERENCES,
  type PawPadWidgetPreferences,
} from "./widget-preferences.js";

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const SIDE_BY_SIDE_MIN_WIDTH = 60;
const PANEL_SEPARATOR = " │ ";

type PawPadTheme = Pick<Theme, "bold" | "fg">;

/** Escape dynamic state before placing it inside PawPad's XML-shaped prompt. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return character;
    }
  });
}

function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const statusDifference =
      (STATUS_ORDER[left.status] ?? 9) - (STATUS_ORDER[right.status] ?? 9);
    if (statusDifference !== 0) return statusDifference;
    return (PRIORITY_ORDER[left.priority ?? "medium"] ?? 1) -
      (PRIORITY_ORDER[right.priority ?? "medium"] ?? 1);
  });
}

function unresolvedBlockers(task: Task, tasks: readonly Task[]): string[] {
  if (task.status === "completed" || !task.blockedBy) return [];
  const statusById = new Map(tasks.map((candidate) => [candidate.id, candidate.status]));
  return task.blockedBy.filter((id) => statusById.get(id) !== "completed");
}

function renderTask(task: Task, tasks: readonly Task[]): string {
  const check = task.status === "completed" ? "x" : " ";
  const prefix = task.status === "in_progress" ? "🔄 " : "";
  const priority = task.priority ? `(${escapeXml(task.priority)}) ` : "";
  const blockers = unresolvedBlockers(task, tasks);
  const blocked = blockers.length > 0
    ? ` 🔒 blocked by: ${blockers.map(escapeXml).join(", ")}`
    : "";
  const description = task.description
    ? `\n  ${escapeXml(task.description)}`
    : "";

  return `- [${check}] ${priority}${prefix}${escapeXml(task.content)}${blocked}${description}`;
}

/** Build the source-compatible PawPad block, or an empty string for empty state. */
export function buildPawPadPrompt(state: PawPadState): string {
  const sections: string[] = [];

  if (state.tasks.length > 0) {
    const completed = state.tasks.filter((task) => task.status === "completed").length;
    const taskList = sortTasks(state.tasks)
      .map((task) => renderTask(task, state.tasks))
      .join("\n");
    sections.push(
      `<tasks description="Session tasks (${completed}/${state.tasks.length} done)">\n${taskList}\n</tasks>`,
    );
  }

  const trimmedNotes = state.notes.trim();
  if (trimmedNotes) {
    sections.push(
      `<notes description="Session notes">\n${escapeXml(trimmedNotes)}\n</notes>`,
    );
  }

  if (sections.length === 0) return "";

  const preamble =
    "Your persistent session state — survives context compaction.\n" +
    "Update via pawpad_tasks and pawpad_note tools. Keep these current as you work.\n" +
    "Use tasks for executable work. Proactively append concise notes for durable decisions, " +
    "constraints, user preferences, verified findings, and non-obvious rationale; do not duplicate transient task progress.";

  return `<pawpad>\n${preamble}\n\n${sections.join("\n\n")}\n</pawpad>`;
}

/** Remove terminal escape/control characters before rendering user-authored text. */
export function sanitizeDisplayText(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
}

function oneLine(value: string): string {
  return sanitizeDisplayText(value).replace(/\s+/gu, " ").trim();
}

function statusMarker(task: Task): "[ ]" | "[~]" | "[x]" {
  switch (task.status) {
    case "in_progress":
      return "[~]";
    case "completed":
      return "[x]";
    case "pending":
      return "[ ]";
  }
}

function styledStatusMarker(task: Task, theme: PawPadTheme): string {
  const marker = statusMarker(task);
  switch (task.status) {
    case "in_progress":
      return theme.fg("warning", marker);
    case "completed":
      return theme.fg("success", marker);
    case "pending":
      return theme.fg("accent", marker);
  }
}

function fitLine(line: string, width: number): string {
  if (width <= 0) return "";
  const fitted = truncateToWidth(line, width, "…");
  return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}

function appendEllipsis(line: string, width: number): string {
  return truncateToWidth(`${line}…`, width, "…");
}

function renderNotes(
  state: PawPadState,
  theme: PawPadTheme,
  width: number,
  maxRows: number,
): string[] {
  const notes = sanitizeDisplayText(state.notes).trim();
  if (!notes) return [];

  const rowLimit = Math.max(1, Math.floor(maxRows));
  const wrapped = wrapTextWithAnsi(notes, Math.max(1, width))
    .filter((line) => line.trim().length > 0);
  const visible = wrapped.slice(0, rowLimit);
  if (wrapped.length > rowLimit) {
    const lastIndex = visible.length - 1;
    visible[lastIndex] = appendEllipsis(visible[lastIndex] ?? "", width);
  }
  return visible.map((line) => theme.fg("accent", line));
}

function renderTasks(
  state: PawPadState,
  theme: PawPadTheme,
  width: number,
  maxRows: number,
): string[] {
  if (state.tasks.length === 0) return [];

  const rowLimit = Math.max(1, Math.floor(maxRows));
  const sorted = sortTasks(state.tasks);
  const visibleCount = sorted.length > rowLimit
    ? Math.max(0, rowLimit - 1)
    : rowLimit;
  const visible = sorted.slice(0, visibleCount);
  const lines = visible.map((task) => {
    const taskText = oneLine(task.content) || "(empty)";
    const content = task.status === "completed"
      ? theme.fg("dim", taskText)
      : theme.fg("accent", taskText);
    const blocked = unresolvedBlockers(task, state.tasks).length > 0
      ? theme.fg("warning", " · blocked")
      : "";
    return truncateToWidth(
      `${styledStatusMarker(task, theme)} ${content}${blocked}`,
      width,
      "…",
    );
  });

  const remaining = sorted.length - visible.length;
  if (remaining > 0) {
    lines.push(
      truncateToWidth(theme.fg("dim", `... +${remaining} more`), width, "…"),
    );
  }
  return lines;
}

function renderPanel(
  header: string,
  body: string[],
  width: number,
  theme: PawPadTheme,
): string[] {
  if (width <= 0) return [];
  return [
    truncateToWidth(theme.bold(theme.fg("accent", header)), width, "…"),
    theme.fg("borderMuted", "─".repeat(width)),
    ...body.map((line) => truncateToWidth(line, width, "…")),
  ];
}

function renderCompactWidget(
  state: PawPadState,
  theme: PawPadTheme,
  width: number,
  completed: number,
  preferences: PawPadWidgetPreferences,
): string[] {
  const notesLabelText = "Notes · ";
  const notesWidth = Math.max(1, width - visibleWidth(notesLabelText));
  const noteLines = renderNotes(
    state,
    theme,
    notesWidth,
    preferences.height,
  ).map((line, index) => {
    const prefix = index === 0
      ? theme.fg("accent", notesLabelText)
      : " ".repeat(visibleWidth(notesLabelText));
    return truncateToWidth(`${prefix}${line}`, width, "…");
  });

  return [
    truncateToWidth(
      theme.bold(theme.fg("accent", `🐾 PawPad · ${completed}/${state.tasks.length} done`)),
      width,
      "…",
    ),
    theme.fg("borderMuted", "─".repeat(width)),
    ...noteLines,
    ...renderTasks(state, theme, width, preferences.height),
  ];
}

/** Render the responsive, display-only PawPad TUI component. */
export function renderPawPadWidget(
  state: PawPadState,
  theme: PawPadTheme,
  width: number,
  preferences: PawPadWidgetPreferences = DEFAULT_WIDGET_PREFERENCES,
): string[] {
  if (width <= 0) return [];

  const hasNotes = preferences.showNotes &&
    sanitizeDisplayText(state.notes).trim().length > 0;
  const hasTasks = preferences.showTasks && state.tasks.length > 0;
  if (!hasNotes && !hasTasks) return [];

  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const notesHeader = "🐾 PawPad · Notes";
  const tasksHeader = `Tasks · ${completed}/${state.tasks.length} done`;

  if (hasNotes && !hasTasks) {
    return renderPanel(
      notesHeader,
      renderNotes(state, theme, width, preferences.height),
      width,
      theme,
    );
  }

  if (hasTasks && !hasNotes) {
    return renderPanel(
      `🐾 PawPad · ${tasksHeader}`,
      renderTasks(state, theme, width, preferences.height),
      width,
      theme,
    );
  }

  if (width < SIDE_BY_SIDE_MIN_WIDTH) {
    return renderCompactWidget(state, theme, width, completed, preferences);
  }

  const availableWidth = width - visibleWidth(PANEL_SEPARATOR);
  const notesWidth = Math.floor(
    availableWidth * preferences.notesWidthPercent / 100,
  );
  const tasksWidth = availableWidth - notesWidth;
  const notesPanel = renderPanel(
    notesHeader,
    renderNotes(state, theme, notesWidth, preferences.height),
    notesWidth,
    theme,
  );
  const tasksPanel = renderPanel(
    tasksHeader,
    renderTasks(state, theme, tasksWidth, preferences.height),
    tasksWidth,
    theme,
  );
  const rowCount = Math.max(notesPanel.length, tasksPanel.length);
  const separator = theme.fg("borderMuted", PANEL_SEPARATOR);
  const lines: string[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    lines.push(
      `${fitLine(notesPanel[index] ?? "", notesWidth)}` +
      `${separator}${fitLine(tasksPanel[index] ?? "", tasksWidth)}`,
    );
  }
  return lines;
}

class PawPadWidgetComponent implements Component {
  constructor(
    private readonly state: PawPadState,
    private readonly theme: PawPadTheme,
    private readonly preferences: PawPadWidgetPreferences,
  ) {}

  render(width: number): string[] {
    return renderPawPadWidget(this.state, this.theme, width, this.preferences);
  }

  invalidate(): void {}
}

/** Build a themed component for Pi's interactive TUI. */
export function createPawPadWidget(
  state: PawPadState,
  theme: Theme,
  preferences: PawPadWidgetPreferences = DEFAULT_WIDGET_PREFERENCES,
): Component {
  return new PawPadWidgetComponent(state, theme, { ...preferences });
}

/**
 * Build a compact string-only fallback for RPC and other non-TUI clients.
 * Component factories are intentionally avoided outside interactive mode.
 */
export function buildPawPadWidget(
  state: PawPadState,
  preferences: PawPadWidgetPreferences = DEFAULT_WIDGET_PREFERENCES,
): string[] | undefined {
  const hasNotes = preferences.showNotes &&
    sanitizeDisplayText(state.notes).trim().length > 0;
  const hasTasks = preferences.showTasks && state.tasks.length > 0;
  if (!hasNotes && !hasTasks) return undefined;

  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const header = hasTasks
    ? `🐾 PawPad · ${completed}/${state.tasks.length} done`
    : "🐾 PawPad · Notes";
  const lines = [header];
  const fallbackTheme: PawPadTheme = {
    bold: (text) => text,
    fg: (_color, text) => text,
  };

  if (hasNotes) {
    const label = "Notes · ";
    const noteWidth = 72 - visibleWidth(label);
    const noteLines = renderNotes(
      state,
      fallbackTheme,
      noteWidth,
      preferences.height,
    );
    noteLines.forEach((line, index) => {
      const prefix = index === 0 ? label : " ".repeat(visibleWidth(label));
      lines.push(stripVTControlCharacters(`${prefix}${line}`));
    });
  }

  if (hasTasks) {
    lines.push(
      ...renderTasks(state, fallbackTheme, 72, preferences.height)
        .map((line) => stripVTControlCharacters(line)),
    );
  }

  return lines;
}
