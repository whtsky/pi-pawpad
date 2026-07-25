import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import pawpadExtension from "../dist/index.js";
import {
  buildPawPadPrompt,
  buildPawPadWidget,
  createPawPadWidget,
  renderPawPadWidget,
  sanitizeDisplayText,
} from "../dist/prompt.js";
import {
  applyWidgetCommand,
  DEFAULT_WIDGET_PREFERENCES,
  reconstructWidgetPreferences,
  storeWidgetPreferences,
  WIDGET_PREFERENCES_ENTRY_TYPE,
} from "../dist/widget-preferences.js";

const plainTheme = {
  bold: (text) => text,
  fg: (_color, text) => text,
};

const ansiTheme = {
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
  fg: (_color, text) => `\x1b[36m${text}\x1b[39m`,
};

function makeState({ tasks = [], notes = "" } = {}) {
  return { tasks, notes, updatedAt: "" };
}

function task(id, content, status, extra = {}) {
  return { id, content, status, ...extra };
}

function preferences(overrides = {}) {
  return { ...DEFAULT_WIDGET_PREFERENCES, ...overrides };
}

test("clears an empty widget and automatically omits empty or hidden sections", () => {
  assert.equal(buildPawPadWidget(makeState()), undefined);
  assert.deepEqual(renderPawPadWidget(makeState(), plainTheme, 80), []);

  const notesOnly = renderPawPadWidget(
    makeState({ notes: "a note" }),
    plainTheme,
    80,
  ).join("\n");
  assert.match(notesOnly, /PawPad · Notes/);
  assert.match(notesOnly, /a note/);
  assert.doesNotMatch(notesOnly, /Tasks|No tasks/);

  const tasksOnlyState = makeState({
    tasks: [task("t1", "Do the thing", "pending")],
  });
  const tasksOnly = renderPawPadWidget(
    tasksOnlyState,
    plainTheme,
    80,
  ).join("\n");
  assert.match(tasksOnly, /PawPad · Tasks · 0\/1 done/);
  assert.match(tasksOnly, /Do the thing/);
  assert.doesNotMatch(tasksOnly, /Notes|No notes/);

  assert.equal(
    buildPawPadWidget(
      makeState({ notes: "hidden" }),
      preferences({ showNotes: false }),
    ),
    undefined,
  );
  assert.deepEqual(
    renderPawPadWidget(
      tasksOnlyState,
      plainTheme,
      80,
      preferences({ showTasks: false }),
    ),
    [],
  );
});

test("keeps every rendered line within narrow and wide terminal widths", () => {
  const state = makeState({
    notes: "多言語 e\u0301lan 🐾 family 👨‍👩‍👧‍👦\nA second line with a longlonglonglonglong token.",
    tasks: [
      task("active", "Implement 多言語 🧪 support with a very long task title", "in_progress"),
      task("pending", "Verify combining e\u0301 and emoji 👩🏽‍💻", "pending"),
      task("done", "Finish the first pass", "completed"),
    ],
  });

  for (const theme of [plainTheme, ansiTheme]) {
    for (const width of [1, 20, 59, 60, 61, 79, 80, 120]) {
      const lines = renderPawPadWidget(state, theme, width);
      assert.ok(lines.length > 0, `expected output at width ${width}`);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= width,
          `line width ${visibleWidth(line)} exceeded ${width}: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("uses a compact single column below 60 and a configurable split at 60+", () => {
  const state = makeState({
    notes: "A real note.",
    tasks: [task("t1", "A real task", "pending")],
  });

  const compact = renderPawPadWidget(state, plainTheme, 59);
  assert.ok(compact.every((line) => !line.includes(" │ ")));
  assert.match(compact[0], /🐾 PawPad · 0\/1 done/);
  assert.match(compact.join("\n"), /Notes · A real note\./);

  const sideBySide = renderPawPadWidget(state, plainTheme, 60);
  assert.ok(sideBySide.every((line) => line.includes(" │ ")));
  assert.match(sideBySide[0], /🐾 PawPad · Notes/);
  assert.match(sideBySide[0], /Tasks · 0\/1 done/);
  assert.equal(visibleWidth(sideBySide[0]), 60);

  const separatorIndex = sideBySide[0].indexOf(" │ ");
  assert.equal(visibleWidth(sideBySide[0].slice(0, separatorIndex)), 28);
  assert.equal(visibleWidth(sideBySide[0].slice(separatorIndex + 3)), 29);

  const notesHeavySplit = renderPawPadWidget(
    state,
    plainTheme,
    60,
    preferences({ notesWidthPercent: 60 }),
  );
  const notesHeavySeparatorIndex = notesHeavySplit[0].indexOf(" │ ");
  assert.equal(visibleWidth(notesHeavySplit[0].slice(0, notesHeavySeparatorIndex)), 34);
  assert.equal(visibleWidth(notesHeavySplit[0].slice(notesHeavySeparatorIndex + 3)), 23);
});


test("renders notes and active task content with the same accent as panel titles", () => {
  const foregroundCalls = [];
  const boldCalls = [];
  const trackingTheme = {
    bold: (text) => {
      boldCalls.push(text);
      return text;
    },
    fg: (color, text) => {
      foregroundCalls.push([color, text]);
      return text;
    },
  };
  const state = makeState({
    notes: "Readable note",
    tasks: [
      task("pending", "Readable pending task", "pending"),
      task("active", "Readable active task", "in_progress"),
      task("done", "Readable completed task", "completed"),
    ],
  });

  renderPawPadWidget(state, trackingTheme, 100);

  for (const text of ["Readable note", "Readable pending task", "Readable active task"]) {
    assert.ok(foregroundCalls.some(([color, value]) => color === "accent" && value === text));
    assert.ok(!boldCalls.includes(text));
  }
  assert.ok(foregroundCalls.some(([color, value]) => color === "accent" && value === "[ ]"));
  assert.ok(foregroundCalls.some(
    ([color, value]) => color === "dim" && value === "Readable completed task",
  ));
});

test("uses one fixed-width status family and sorts active, pending, completed", () => {
  const state = makeState({
    notes: "Status check",
    tasks: [
      task("done", "Completed task", "completed", { blockedBy: ["active"] }),
      task("ready", "Ready task", "pending", { blockedBy: ["done"] }),
      task("pending", "Pending task", "pending", { blockedBy: ["active"] }),
      task("active", "Active task", "in_progress"),
    ],
  });
  const rendered = renderPawPadWidget(state, plainTheme, 120).join("\n");

  assert.ok(rendered.indexOf("[~] Active task") < rendered.indexOf("[ ] Ready task"));
  assert.match(rendered, /Pending task · blocked/);
  assert.doesNotMatch(rendered, /Ready task · blocked/);
  assert.doesNotMatch(rendered, /Completed task · blocked/);
  assert.doesNotMatch(rendered, /☑|☐|🔄/u);
});

test("shows bounded task overflow in wide and extremely narrow layouts", () => {
  const tasks = Array.from({ length: 100 }, (_, index) =>
    task(`t${index}`, `Task ${index}`, "pending"));
  const wide = renderPawPadWidget(
    makeState({ tasks, notes: "Overflow check" }),
    plainTheme,
    120,
  ).join("\n");

  assert.match(wide, /\.\.\. \+97 more/);
  assert.doesNotMatch(wide, /Task 3/);
  assert.doesNotMatch(wide, /Task 99/);

  for (const width of [1, 5, 10]) {
    const narrow = renderPawPadWidget(
      makeState({ tasks, notes: "Overflow check" }),
      plainTheme,
      width,
    );
    assert.ok(narrow.every((line) => visibleWidth(line) <= width));
  }
});

test("balances both panels with a configurable body-row height", () => {
  const state = makeState({
    notes: "one\ntwo\nthree\nfour\nfive",
    tasks: Array.from({ length: 6 }, (_, index) =>
      task(`t${index}`, `Task ${index}`, "pending")),
  });
  const defaultRendered = renderPawPadWidget(state, plainTheme, 120);
  const defaultJoined = defaultRendered.join("\n");

  assert.equal(defaultRendered.length, 6);
  assert.match(defaultJoined, /four…/u);
  assert.doesNotMatch(defaultJoined, /five/);
  assert.match(defaultJoined, /\.\.\. \+3 more/);

  const shortRendered = renderPawPadWidget(
    state,
    plainTheme,
    120,
    preferences({ height: 2 }),
  );
  const shortJoined = shortRendered.join("\n");
  assert.equal(shortRendered.length, 4);
  assert.match(shortJoined, /two…/u);
  assert.doesNotMatch(shortJoined, /three/);
  assert.match(shortJoined, /\.\.\. \+5 more/);
});

test("removes terminal escape and control characters from notes and tasks", () => {
  const hostile = "\x1b]0;owned\x07Title \x1b[31mred\x1b[0m\tbell\x07";
  const sanitized = sanitizeDisplayText(hostile);
  assert.doesNotMatch(sanitized, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);

  const state = makeState({
    notes: hostile,
    tasks: [task("t1", hostile, "pending")],
  });
  for (const line of renderPawPadWidget(state, plainTheme, 80)) {
    assert.doesNotMatch(line, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  }
  for (const line of buildPawPadWidget(state) ?? []) {
    assert.doesNotMatch(line, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  }

  const longFallback = buildPawPadWidget(makeState({ notes: "x".repeat(100) })) ?? [];
  for (const line of longFallback) {
    assert.doesNotMatch(line, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  }
});

test("provides compact note text and matching statuses in the RPC fallback", () => {
  const fallback = buildPawPadWidget(makeState({
    notes: "Remember this decision.\n\nKeep the preview dense.",
    tasks: [
      task("active", "Working", "in_progress"),
      task("pending", "Waiting", "pending"),
      task("done", "Finished", "completed"),
    ],
  }));

  assert.ok(fallback);
  assert.match(fallback.join("\n"), /Notes · Remember this decision\./);
  assert.match(fallback.join("\n"), /Keep the preview dense\./);
  assert.ok(fallback.every((line) => line.trim().length > 0));
  assert.match(fallback.join("\n"), /\[~\] Working/);
  assert.match(fallback.join("\n"), /\[ \] Waiting/);
  assert.match(fallback.join("\n"), /\[x\] Finished/);
});

test("gives models proactive, scoped guidance for durable notes", () => {
  const prompt = buildPawPadPrompt(makeState({ notes: "A durable decision." }));
  assert.match(prompt, /Proactively append concise notes for durable decisions/);
  assert.match(prompt, /do not duplicate transient task progress/);

  const tools = [];
  pawpadExtension({
    on: () => {},
    registerTool: (tool) => tools.push(tool),
    registerCommand: () => {},
    appendEntry: () => {},
  });
  const noteTool = tools.find((tool) => tool.name === "pawpad_note");
  assert.ok(noteTool);
  assert.match(noteTool.description, /Proactively record durable decisions/);
  assert.match(noteTool.promptGuidelines.join("\n"), /immediately append a concise note/);
  assert.match(noteTool.promptGuidelines.join("\n"), /Do not wait for compaction/);
});

test("extension integration selects a TUI component, RPC lines, and empty clear", async () => {
  const handlers = new Map();
  pawpadExtension({
    on: (event, handler) => handlers.set(event, handler),
    registerTool: () => {},
    registerCommand: () => {},
    appendEntry: () => {},
  });
  const sessionStart = handlers.get("session_start");
  assert.equal(typeof sessionStart, "function");

  const calls = [];
  const makeContext = (mode, branch) => ({
    hasUI: true,
    mode,
    sessionManager: { getBranch: () => branch },
    ui: {
      setWidget: (...args) => calls.push(args),
    },
  });

  await sessionStart({}, makeContext("tui", []));
  assert.deepEqual(calls.at(-1), ["pawpad", undefined]);

  const state = makeState({
    notes: "Integration note",
    tasks: [task("t1", "Integration task", "pending")],
  });
  const branch = [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "pawpad_note",
      details: { version: 1, action: "write", state },
    },
  }];

  await sessionStart({}, makeContext("tui", branch));
  const tuiContent = calls.at(-1)?.[1];
  assert.equal(typeof tuiContent, "function");
  assert.match(tuiContent({}, plainTheme).render(80).join("\n"), /Integration note/);

  await sessionStart({}, makeContext("rpc", branch));
  const rpcContent = calls.at(-1)?.[1];
  assert.ok(Array.isArray(rpcContent));
  assert.match(rpcContent.join("\n"), /Notes · Integration note/);
});

test("replays PawPad state from the active branch before every agent turn", async () => {
  const handlers = new Map();
  const tools = [];
  pawpadExtension({
    on: (event, handler) => handlers.set(event, handler),
    registerTool: (tool) => tools.push(tool),
    registerCommand: () => {},
    appendEntry: () => {},
  });

  const firstState = makeState({
    notes: "First branch note",
    tasks: [task("first", "First branch task", "in_progress")],
  });
  const secondState = makeState({
    notes: "Sibling branch note",
    tasks: [task("second", "Sibling branch task", "pending")],
  });
  const branchFor = (state) => [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "pawpad_tasks",
      details: { version: 1, action: "write", state },
    },
  }];

  let activeBranch = branchFor(firstState);
  const ctx = {
    hasUI: false,
    mode: "rpc",
    sessionManager: { getBranch: () => activeBranch },
  };

  await handlers.get("session_start")({}, ctx);
  const firstPrompt = await handlers.get("before_agent_start")(
    { systemPrompt: "Base prompt" },
    ctx,
  );
  assert.match(firstPrompt.systemPrompt, /^Base prompt/);
  assert.match(firstPrompt.systemPrompt, /First branch note/);
  assert.match(firstPrompt.systemPrompt, /First branch task/);

  activeBranch = branchFor(secondState);
  await handlers.get("session_tree")({}, ctx);
  const secondPrompt = await handlers.get("before_agent_start")(
    { systemPrompt: "Base prompt" },
    ctx,
  );
  assert.match(secondPrompt.systemPrompt, /Sibling branch note/);
  assert.doesNotMatch(secondPrompt.systemPrompt, /First branch note/);

  activeBranch = [];
  assert.equal(
    await handlers.get("before_agent_start")({ systemPrompt: "Base prompt" }, ctx),
    undefined,
  );
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["pawpad_note", "pawpad_tasks"]);
});

test("parses widget commands and replays valid branch-local preferences", () => {
  const initial = preferences();
  assert.equal(initial.notesWidthPercent, 50);
  const hiddenNotes = applyWidgetCommand("hide notes", initial);
  assert.equal(hiddenNotes.changed, true);
  assert.equal(hiddenNotes.preferences.showNotes, false);

  const taller = applyWidgetCommand("height 6", hiddenNotes.preferences);
  assert.equal(taller.preferences.height, 6);

  const widerNotes = applyWidgetCommand("ratio 45", taller.preferences);
  assert.equal(widerNotes.preferences.notesWidthPercent, 45);

  const invalid = applyWidgetCommand("height 1", widerNotes.preferences);
  assert.equal(invalid.isError, true);
  assert.equal(invalid.changed, false);

  const stored = storeWidgetPreferences(widerNotes.preferences);
  const replayed = reconstructWidgetPreferences([
    {
      type: "custom",
      customType: WIDGET_PREFERENCES_ENTRY_TYPE,
      data: { version: 99 },
    },
    {
      type: "custom",
      customType: WIDGET_PREFERENCES_ENTRY_TYPE,
      data: stored,
    },
  ]);
  assert.deepEqual(replayed, widerNotes.preferences);
});

test("the /pawpad command updates, persists, and immediately rerenders preferences", async () => {
  const handlers = new Map();
  const commands = new Map();
  const appended = [];
  pawpadExtension({
    on: (event, handler) => handlers.set(event, handler),
    registerTool: () => {},
    registerCommand: (name, definition) => commands.set(name, definition),
    appendEntry: (...args) => appended.push(args),
  });

  const state = makeState({
    notes: "Command note",
    tasks: [task("t1", "Command task", "pending")],
  });
  const branch = [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "pawpad_note",
      details: { version: 1, action: "write", state },
    },
  }];
  const widgetCalls = [];
  const notifications = [];
  let activeBranch = branch;
  const ctx = {
    hasUI: true,
    mode: "tui",
    sessionManager: { getBranch: () => activeBranch },
    ui: {
      setWidget: (...args) => widgetCalls.push(args),
      notify: (...args) => notifications.push(args),
    },
  };

  await handlers.get("session_start")({}, ctx);

  activeBranch = [
    ...branch,
    {
      type: "custom",
      customType: WIDGET_PREFERENCES_ENTRY_TYPE,
      data: storeWidgetPreferences(preferences({ showNotes: false })),
    },
  ];
  await handlers.get("session_tree")({}, ctx);
  const branchTasksOnly = widgetCalls.at(-1)?.[1]({}, plainTheme).render(80).join("\n");
  assert.doesNotMatch(branchTasksOnly, /Command note|Notes/);

  activeBranch = branch;
  await handlers.get("session_tree")({}, ctx);
  const restoredBoth = widgetCalls.at(-1)?.[1]({}, plainTheme).render(80).join("\n");
  assert.match(restoredBoth, /Command note/);
  assert.match(restoredBoth, /Command task/);

  const command = commands.get("pawpad");
  assert.ok(command);
  assert.ok(command.getArgumentCompletions("hide n").some((item) => item.value === "hide notes"));

  await command.handler("hide notes", ctx);
  assert.equal(appended.at(-1)?.[0], WIDGET_PREFERENCES_ENTRY_TYPE);
  const tasksOnlyFactory = widgetCalls.at(-1)?.[1];
  const tasksOnly = tasksOnlyFactory({}, plainTheme).render(80).join("\n");
  assert.match(tasksOnly, /Command task/);
  assert.doesNotMatch(tasksOnly, /Command note|Notes/);

  await command.handler("hide tasks", ctx);
  assert.deepEqual(widgetCalls.at(-1), ["pawpad", undefined]);
  assert.match(notifications.at(-1)?.[0], /notes off, tasks off/);
});

test("component invalidation is safe and does not change its snapshot rendering", () => {
  const state = makeState({
    notes: "Stable note",
    tasks: [task("t1", "Stable task", "pending")],
  });
  const component = createPawPadWidget(state, plainTheme);
  const before = component.render(81);
  component.invalidate();
  assert.deepEqual(component.render(81), before);
});
