# pi-pawpad

Pi extension that provides branch-safe task tracking, durable notes, and a compact TUI widget.

## Key design decisions

- This is a Pi package and extension. Register model-facing tools with `pi.registerTool()` and lifecycle hooks with `pi.on()`.
- Persist complete, versioned PawPad snapshots in tool-result `details.state`. Reconstruct only from `ctx.sessionManager.getBranch()` so `/tree`, `/fork`, `/clone`, compaction, reload, and resume follow Pi's branch semantics.
- `/new` intentionally starts empty. PawPad does not use external files or OpenClaw's stable `sessionKey` storage model.
- Use `StringEnum` from `@earendil-works/pi-ai` for provider-compatible string enums. Keep Pi core packages in `peerDependencies` with `"*"` ranges.
- Keep persisted state and prompt injection within the limits in `src/limits.ts`. Invalid or oversized writes must throw without changing the previous state.
- Guard UI work with `ctx.hasUI`. Use the component renderer only in TUI mode and retain the string-array RPC fallback.
- Widget preferences are branch-local custom entries and must stay outside model context.
- `dist/` is committed because Pi can install this repository directly. `prepack` must rebuild it from source.

## Verification

Run before committing or releasing:

```bash
npm ci
npm test
npm run typecheck
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

## Changelog

Maintain `CHANGELOG.md` using Keep a Changelog categories. Record every user-facing behavior change under `Unreleased`; internal-only test or CI changes do not require an entry.

## Releases

For future releases, update `package.json` and `CHANGELOG.md`, verify the package, commit, and create a matching `vX.Y.Z` tag. The protected publish workflow is intentionally tag-triggered and must never publish on every push to `main`.
