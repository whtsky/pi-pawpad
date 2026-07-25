export interface PawPadWidgetPreferences {
  showNotes: boolean;
  showTasks: boolean;
  /** Maximum body rows rendered by each visible section. */
  height: number;
  /** Percentage of split-view width assigned to Notes. */
  notesWidthPercent: number;
}

export const MIN_WIDGET_HEIGHT = 2;
export const MAX_WIDGET_HEIGHT = 12;
export const MIN_NOTES_WIDTH_PERCENT = 25;
export const MAX_NOTES_WIDTH_PERCENT = 75;
export const WIDGET_PREFERENCES_ENTRY_TYPE = "pawpad-widget-preferences";

export const DEFAULT_WIDGET_PREFERENCES: Readonly<PawPadWidgetPreferences> =
  Object.freeze({
    showNotes: true,
    showTasks: true,
    height: 4,
    notesWidthPercent: 50,
  });

interface StoredWidgetPreferences {
  version: 1;
  preferences: PawPadWidgetPreferences;
}

export interface WidgetPreferencesBranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

export interface PawPadWidgetCommandResult {
  preferences: PawPadWidgetPreferences;
  changed: boolean;
  message: string;
  isError: boolean;
}

export const PAWPAD_ARGUMENT_COMPLETIONS = [
  "show notes",
  "show tasks",
  "show all",
  "hide notes",
  "hide tasks",
  "hide all",
  "toggle notes",
  "toggle tasks",
  "toggle all",
  "height 4",
  "ratio 50",
  "reset",
  "help",
] as const;

export function cloneWidgetPreferences(
  preferences: PawPadWidgetPreferences,
): PawPadWidgetPreferences {
  return { ...preferences };
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

export function parseStoredWidgetPreferences(
  value: unknown,
): PawPadWidgetPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stored = value as Partial<StoredWidgetPreferences>;
  if (stored.version !== 1 || !stored.preferences || typeof stored.preferences !== "object") {
    return undefined;
  }

  const preferences = stored.preferences as Partial<PawPadWidgetPreferences>;
  if (typeof preferences.showNotes !== "boolean" ||
      typeof preferences.showTasks !== "boolean" ||
      !isIntegerInRange(preferences.height, MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT) ||
      !isIntegerInRange(
        preferences.notesWidthPercent,
        MIN_NOTES_WIDTH_PERCENT,
        MAX_NOTES_WIDTH_PERCENT,
      )) {
    return undefined;
  }

  return {
    showNotes: preferences.showNotes,
    showTasks: preferences.showTasks,
    height: preferences.height,
    notesWidthPercent: preferences.notesWidthPercent,
  };
}

export function storeWidgetPreferences(
  preferences: PawPadWidgetPreferences,
): StoredWidgetPreferences {
  return {
    version: 1,
    preferences: cloneWidgetPreferences(preferences),
  };
}

export function reconstructWidgetPreferences(
  entries: readonly WidgetPreferencesBranchEntry[],
): PawPadWidgetPreferences {
  let preferences = cloneWidgetPreferences(DEFAULT_WIDGET_PREFERENCES);

  for (const entry of entries) {
    if (entry.type !== "custom" ||
        entry.customType !== WIDGET_PREFERENCES_ENTRY_TYPE) {
      continue;
    }
    const parsed = parseStoredWidgetPreferences(entry.data);
    if (parsed) preferences = parsed;
  }

  return preferences;
}

function preferencesEqual(
  left: PawPadWidgetPreferences,
  right: PawPadWidgetPreferences,
): boolean {
  return left.showNotes === right.showNotes &&
    left.showTasks === right.showTasks &&
    left.height === right.height &&
    left.notesWidthPercent === right.notesWidthPercent;
}

export function describeWidgetPreferences(
  preferences: PawPadWidgetPreferences,
): string {
  return `PawPad widget: notes ${preferences.showNotes ? "on" : "off"}, ` +
    `tasks ${preferences.showTasks ? "on" : "off"}, ` +
    `height ${preferences.height}, ` +
    `width ${preferences.notesWidthPercent}/${100 - preferences.notesWidthPercent}. ` +
    "Empty sections hide automatically.";
}

const COMMAND_HELP =
  "Usage: /pawpad [show|hide|toggle] [notes|tasks|all] | " +
  "/pawpad height <2-12> | /pawpad ratio <25-75> | /pawpad reset";

function result(
  current: PawPadWidgetPreferences,
  next: PawPadWidgetPreferences,
  message: string,
  isError = false,
): PawPadWidgetCommandResult {
  return {
    preferences: next,
    changed: !preferencesEqual(current, next),
    message,
    isError,
  };
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function applyWidgetCommand(
  args: string,
  current: PawPadWidgetPreferences,
): PawPadWidgetCommandResult {
  const normalized = args.trim().toLowerCase();
  if (!normalized) {
    return result(current, cloneWidgetPreferences(current), describeWidgetPreferences(current));
  }

  const parts = normalized.split(/\s+/u);
  const action = parts[0];

  if (action === "help") {
    return result(current, cloneWidgetPreferences(current), COMMAND_HELP);
  }

  if (action === "reset" && parts.length === 1) {
    const next = cloneWidgetPreferences(DEFAULT_WIDGET_PREFERENCES);
    return result(current, next, describeWidgetPreferences(next));
  }

  if (action === "height" && parts.length === 2) {
    const height = parseInteger(parts[1]);
    if (height === undefined || height < MIN_WIDGET_HEIGHT || height > MAX_WIDGET_HEIGHT) {
      return result(
        current,
        cloneWidgetPreferences(current),
        `Height must be an integer from ${MIN_WIDGET_HEIGHT} to ${MAX_WIDGET_HEIGHT}.`,
        true,
      );
    }
    const next = { ...current, height };
    return result(current, next, describeWidgetPreferences(next));
  }

  if ((action === "ratio" || action === "width") && parts.length === 2) {
    const notesWidthPercent = parseInteger(parts[1]);
    if (notesWidthPercent === undefined ||
        notesWidthPercent < MIN_NOTES_WIDTH_PERCENT ||
        notesWidthPercent > MAX_NOTES_WIDTH_PERCENT) {
      return result(
        current,
        cloneWidgetPreferences(current),
        `Notes width must be an integer from ${MIN_NOTES_WIDTH_PERCENT} to ` +
          `${MAX_NOTES_WIDTH_PERCENT}. Tasks receive the remainder.`,
        true,
      );
    }
    const next = { ...current, notesWidthPercent };
    return result(current, next, describeWidgetPreferences(next));
  }

  if ((action === "show" || action === "hide" || action === "toggle") &&
      parts.length === 2) {
    const target = parts[1];
    if (target !== "notes" && target !== "tasks" && target !== "all") {
      return result(current, cloneWidgetPreferences(current), COMMAND_HELP, true);
    }

    const next = cloneWidgetPreferences(current);
    const targetValue = (currentValue: boolean): boolean => {
      if (action === "show") return true;
      if (action === "hide") return false;
      return !currentValue;
    };

    if (target === "notes" || target === "all") {
      next.showNotes = targetValue(
        target === "all" && action === "toggle"
          ? current.showNotes && current.showTasks
          : current.showNotes,
      );
    }
    if (target === "tasks" || target === "all") {
      next.showTasks = targetValue(
        target === "all" && action === "toggle"
          ? current.showNotes && current.showTasks
          : current.showTasks,
      );
    }

    return result(current, next, describeWidgetPreferences(next));
  }

  return result(current, cloneWidgetPreferences(current), COMMAND_HELP, true);
}
