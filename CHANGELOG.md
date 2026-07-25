# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-07-25

### Added

- Persistent `pawpad_tasks` and `pawpad_note` tools backed by versioned snapshots in Pi session history.
- Active-branch replay across compaction, reload, resume, `/tree`, `/fork`, and `/clone`; `/new` starts empty.
- Responsive Notes and Tasks widget with TUI components, an RPC-safe fallback, smart empty-section omission, and width-safe rendering.
- Session-local `/pawpad` controls for section visibility, body height, and Notes/Tasks width ratio.
- Provider-compatible tool schemas for Google/Gemini, OpenAI, and Anthropic providers.
- Atomic state, task, field, byte, and line limits that reject oversized writes without replacing valid state.
- Regression coverage for tools, validation, warnings, branch lifecycle, prompt injection, widget rendering, RPC behavior, and commands.
