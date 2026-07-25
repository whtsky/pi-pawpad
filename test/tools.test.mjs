import assert from "node:assert/strict";
import test from "node:test";
import {
  PawPadNoteParameters,
  PawPadTasksParameters,
  createNoteTool,
  createTasksTool,
} from "../dist/tools.js";

const config = {
  warnCompletedTasks: 1,
  warnNoteChars: 10,
};

function task(id, status = "pending", extra = {}) {
  return {
    id,
    content: `Task ${id}`,
    status,
    ...extra,
  };
}

function makeRuntime(initial = { tasks: [], notes: "", updatedAt: "" }) {
  let state = structuredClone(initial);
  let changeCount = 0;
  return {
    runtime: {
      getState: () => structuredClone(state),
      setState: (next) => {
        state = structuredClone(next);
      },
      withLock: (operation) => operation(),
      stateChanged: () => {
        changeCount += 1;
      },
    },
    getState: () => structuredClone(state),
    getChangeCount: () => changeCount,
  };
}

async function execute(tool, params) {
  return tool.execute(
    "test-call",
    params,
    new AbortController().signal,
    () => {},
    {},
  );
}

function resultText(result) {
  return result.content.map((part) => part.type === "text" ? part.text : "").join("");
}

test("uses provider-compatible string enum schemas", () => {
  const taskAction = PawPadTasksParameters.properties.action;
  const noteAction = PawPadNoteParameters.properties.action;
  const status = PawPadTasksParameters.properties.tasks.items.properties.status;
  const priority = PawPadTasksParameters.properties.tasks.items.properties.priority;

  assert.deepEqual(taskAction.enum, ["read", "write"]);
  assert.deepEqual(noteAction.enum, ["read", "write", "append"]);
  assert.deepEqual(status.enum, ["pending", "in_progress", "completed"]);
  assert.deepEqual(priority.enum, ["high", "medium", "low"]);
  for (const schema of [taskAction, noteAction, status, priority]) {
    assert.equal(schema.type, "string");
    assert.equal(schema.anyOf, undefined);
  }
});

test("writes, replaces, reads, and snapshots tasks", async () => {
  const harness = makeRuntime();
  const tool = createTasksTool(harness.runtime, config);
  const tasks = [task("active", "in_progress"), task("done-1", "completed"), task("done-2", "completed")];

  const write = await execute(tool, { action: "write", tasks });
  assert.match(resultText(write), /Tasks updated \(3 tasks: 1 in_progress, 2 completed\)/);
  assert.match(resultText(write), /completed tasks accumulating/);
  assert.deepEqual(write.details.state.tasks, tasks);
  assert.equal(harness.getChangeCount(), 1);

  write.details.state.tasks[0].content = "mutated result";
  assert.equal(harness.getState().tasks[0].content, "Task active");

  const read = await execute(tool, { action: "read" });
  assert.deepEqual(JSON.parse(resultText(read).split("\n\n⚠️")[0]).tasks, tasks);
  assert.equal(harness.getChangeCount(), 1);

  const clear = await execute(tool, { action: "write", tasks: [] });
  assert.match(resultText(clear), /Tasks updated \(0 tasks\)/);
  assert.deepEqual(harness.getState().tasks, []);
});

test("throws tool errors for invalid task writes without changing state", async () => {
  const initial = { tasks: [task("existing")], notes: "", updatedAt: "before" };
  const harness = makeRuntime(initial);
  const tool = createTasksTool(harness.runtime, config);

  await assert.rejects(() => execute(tool, { action: "write" }), /tasks array is required/);
  await assert.rejects(
    () => execute(tool, { action: "write", tasks: [task("dup"), task("dup")] }),
    /Duplicate task id/,
  );
  assert.deepEqual(harness.getState(), initial);
  assert.equal(harness.getChangeCount(), 0);
});

test("writes, appends, reads, and snapshots notes", async () => {
  const harness = makeRuntime();
  const tool = createNoteTool(harness.runtime, config);

  const write = await execute(tool, { action: "write", content: "first durable note" });
  assert.match(resultText(write), /Notes updated/);
  assert.match(resultText(write), /Consider condensing/);
  assert.equal(write.details.state.notes, "first durable note");

  const append = await execute(tool, { action: "append", content: "second note" });
  assert.match(resultText(append), /Notes appended/);
  assert.equal(harness.getState().notes, "first durable note\n\nsecond note");

  const read = await execute(tool, { action: "read" });
  assert.match(resultText(read), /^first durable note\n\nsecond note/);
  assert.equal(harness.getChangeCount(), 2);
});

test("throws tool errors for invalid or oversized note writes without changing state", async () => {
  const initial = { tasks: [], notes: "safe", updatedAt: "" };
  const harness = makeRuntime(initial);
  const tool = createNoteTool(harness.runtime, config);

  await assert.rejects(
    () => execute(tool, { action: "append" }),
    /content is required for append action/,
  );
  await assert.rejects(
    () => execute(tool, { action: "write", content: "&".repeat(10_000) }),
    /PawPad context is.*Condense notes or tasks/,
  );
  assert.deepEqual(harness.getState(), initial);
  assert.equal(harness.getChangeCount(), 0);
});
