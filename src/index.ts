import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildPawPadPrompt,
  buildPawPadWidget,
  createPawPadWidget,
} from "./prompt.js";
import {
  cloneState,
  EMPTY_STATE,
  reconstructStateFromBranch,
  type PawPadState,
} from "./state.js";
import {
  createNoteTool,
  createTasksTool,
  type PawPadToolConfig,
  type PawPadRuntime,
} from "./tools.js";
import {
  applyWidgetCommand,
  cloneWidgetPreferences,
  DEFAULT_WIDGET_PREFERENCES,
  PAWPAD_ARGUMENT_COMPLETIONS,
  reconstructWidgetPreferences,
  storeWidgetPreferences,
  WIDGET_PREFERENCES_ENTRY_TYPE,
  type PawPadWidgetPreferences,
} from "./widget-preferences.js";

const WIDGET_KEY = "pawpad";

const DEFAULT_CONFIG: PawPadToolConfig = {
  warnCompletedTasks: 30,
  warnNoteChars: 10_000,
};

function readNonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return fallback;
}

function getConfig(): PawPadToolConfig {
  return {
    warnCompletedTasks: readNonNegativeInteger(
      "PAWPAD_WARN_COMPLETED_TASKS",
      DEFAULT_CONFIG.warnCompletedTasks,
    ),
    warnNoteChars: readNonNegativeInteger(
      "PAWPAD_WARN_NOTE_CHARS",
      DEFAULT_CONFIG.warnNoteChars,
    ),
  };
}

function refreshWidget(
  ctx: ExtensionContext,
  state: PawPadState,
  preferences: PawPadWidgetPreferences,
  enabled: boolean,
): void {
  if (!ctx.hasUI) return;
  if (!enabled) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  const fallback = buildPawPadWidget(state, preferences);
  if (!fallback) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  if (ctx.mode === "tui") {
    ctx.ui.setWidget(
      WIDGET_KEY,
      (_tui, theme) => createPawPadWidget(state, theme, preferences),
    );
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, fallback);
}

/**
 * Pi extension entry point.
 *
 * State is reconstructed from the active session branch instead of being
 * keyed by an OpenClaw sessionKey or stored in an external file.
 */
export default function pawpadExtension(pi: ExtensionAPI): void {
  let state = cloneState(EMPTY_STATE);
  let widgetPreferences = cloneWidgetPreferences(DEFAULT_WIDGET_PREFERENCES);
  let stateQueue: Promise<void> = Promise.resolve();
  const config = getConfig();
  const widgetEnabled = readBoolean("PAWPAD_WIDGET", true);

  function reconstruct(ctx: ExtensionContext): void {
    const branch = ctx.sessionManager.getBranch();
    state = reconstructStateFromBranch(branch);
    widgetPreferences = reconstructWidgetPreferences(branch);
    refreshWidget(ctx, state, widgetPreferences, widgetEnabled);
  }

  const runtime: PawPadRuntime = {
    getState: () => cloneState(state),
    setState: (next) => {
      state = cloneState(next);
    },
    withLock: <T>(operation: () => Promise<T>): Promise<T> => {
      const queued = stateQueue.then(() => operation());
      stateQueue = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    stateChanged: (ctx) => {
      refreshWidget(ctx, state, widgetPreferences, widgetEnabled);
    },
  };

  pi.registerTool(createTasksTool(runtime, config));
  pi.registerTool(createNoteTool(runtime, config));

  pi.registerCommand("pawpad", {
    description: "Configure the PawPad Notes/Tasks widget",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trimStart().toLowerCase();
      const matches = PAWPAD_ARGUMENT_COMPLETIONS
        .filter((value) => value.startsWith(normalized))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const command = applyWidgetCommand(args, widgetPreferences);
      if (command.changed) {
        widgetPreferences = command.preferences;
        pi.appendEntry(
          WIDGET_PREFERENCES_ENTRY_TYPE,
          storeWidgetPreferences(widgetPreferences),
        );
        refreshWidget(ctx, state, widgetPreferences, widgetEnabled);
      }

      const disabledMessage = widgetEnabled
        ? ""
        : " PAWPAD_WIDGET is disabled by the environment.";
      ctx.ui.notify(
        `${command.message}${disabledMessage}`,
        command.isError ? "error" : widgetEnabled ? "info" : "warning",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    reconstruct(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstruct(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Re-read the active branch each turn so reloads and branch navigation can
    // never leave the prompt using a sibling branch's in-memory state.
    reconstruct(ctx);
    const injection = buildPawPadPrompt(state);
    if (!injection) return;

    return {
      systemPrompt: event.systemPrompt
        ? `${event.systemPrompt}\n\n${injection}`
        : injection,
    };
  });
}
