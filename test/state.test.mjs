import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TASK_CONTENT_CHARS,
  MAX_TASK_ID_CHARS,
  MAX_TASKS,
  assertPawPadStateWithinLimits,
  getPawPadStateLimitError,
} from "../dist/limits.js";
import {
  cloneState,
  parsePawPadToolDetails,
  reconstructStateFromBranch,
  validateTasks,
} from "../dist/state.js";

function task(id, content = `Task ${id}`, status = "pending", extra = {}) {
  return { id, content, status, ...extra };
}

function details(state, action = "write") {
  return { version: 1, action, state };
}

test("validates task fields, limits, and duplicate identifiers", () => {
  assert.deepEqual(validateTasks([task("t1")]), [task("t1")]);
  assert.throws(
    () => validateTasks([task("dup"), task("dup")]),
    /Duplicate task id/,
  );
  assert.throws(
    () => validateTasks([task("x".repeat(MAX_TASK_ID_CHARS + 1))]),
    /id must be at most/,
  );
  assert.throws(
    () => validateTasks([task("t1", "x".repeat(MAX_TASK_CONTENT_CHARS + 1))]),
    /content must be at most/,
  );
  assert.throws(
    () => validateTasks(Array.from({ length: MAX_TASKS + 1 }, (_, index) => task(`t${index}`))),
    /at most 100 items/,
  );
  assert.throws(
    () => validateTasks([task("t1", "Task", "invalid")]),
    /status must be/,
  );
});

test("clones nested task state without retaining mutable arrays", () => {
  const source = {
    tasks: [task("t1", "Blocked", "pending", { blockedBy: ["t0"] })],
    notes: "note",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const cloned = cloneState(source);
  cloned.tasks[0].blockedBy.push("t2");

  assert.deepEqual(source.tasks[0].blockedBy, ["t0"]);
  assert.notEqual(cloned.tasks, source.tasks);
});

test("reconstructs the latest valid snapshot on the active branch", () => {
  const first = { tasks: [task("first")], notes: "one", updatedAt: "one" };
  const second = { tasks: [task("second")], notes: "two", updatedAt: "two" };
  const branch = [
    { type: "message", message: { role: "toolResult", toolName: "other", details: details(first) } },
    { type: "message", message: { role: "toolResult", toolName: "pawpad_tasks", details: details(first) } },
    { type: "message", message: { role: "toolResult", toolName: "pawpad_note", details: { version: 99, state: second } } },
    { type: "message", message: { role: "toolResult", toolName: "pawpad_note", details: details(second, "append") } },
  ];

  assert.deepEqual(reconstructStateFromBranch(branch), second);
  assert.deepEqual(parsePawPadToolDetails(details(second)), second);
});

test("rejects state that would exceed the stored or injected context budget", () => {
  const oversized = {
    tasks: [],
    notes: "&".repeat(10_000),
    updatedAt: "",
  };
  assert.match(getPawPadStateLimitError(oversized), /PawPad context is/);
  assert.throws(() => assertPawPadStateWithinLimits(oversized), /Condense notes or tasks/);
  assert.equal(parsePawPadToolDetails(details(oversized)), undefined);
});
