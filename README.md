# Agenty

A desktop app that runs the AI coding CLIs **already installed and signed in on your machine** — Claude Code, Codex, Gemini, Qwen, Cursor Agent, Copilot, OpenCode and Ollama — side by side, from a single VS Code-style interface.

No API keys, no login screens: every CLI uses its own existing session. Agenty never stores or sees your credentials.

## Features

- **Setup wizard** – scans your `PATH` for supported CLIs and shows each one's version, sign-in status and available models, with install/login commands for anything missing.
- **Three run modes**
  - **Single** – one model answers or works with the permission level you choose.
  - **Analysis → Code** – an analysis model inspects the repo (read-only) and writes a plan; after your optional approval, a coding model implements it in the working folder.
  - **Parallel** – the same prompt goes to several models at once; answers are shown side by side.
- **Permission levels** – read-only, file editing, or full access, mapped to each CLI's own flags.
- **Conversation continuity** – Claude Code and Codex resume their native sessions; other CLIs receive recent turns as context.
- **Git change tracking** – files changed by a coding run are listed after it finishes; click to open.
- **Live activity** – streamed output, tool calls, commands, file edits, token usage and cost (where the CLI reports it).
- **VS Code-style UI** – activity bar, session list (pin, rename, delete, export), full-text search across all sessions, command palette, status bar, dark and light themes.
- **Local-first** – sessions are stored as JSON on your machine and can be exported to Markdown.

## Supported CLIs

| CLI | Output handling | Session resume |
|---|---|---|
| Claude Code | `stream-json` (streaming text, tools, cost) | ✅ |
| Codex CLI | JSONL events (messages, commands, file changes) | ✅ |
| Cursor Agent | `stream-json` | ✅ |
| Gemini CLI | plain text | context replay |
| Qwen Code | plain text | context replay |
| GitHub Copilot CLI | plain text | context replay |
| OpenCode | plain text | context replay |
| Ollama | plain text (chat only, no file editing) | context replay |

> Tested end-to-end on Windows with Claude Code, Codex and Ollama. The other CLIs are integrated according to their documented flags but have not been verified yet.

## Getting started

Requirements: Node.js 20+ and at least one supported CLI installed and signed in.

```bash
npm install
npm run dev        # development with hot reload
npm run build      # compile to out/
npm run dist       # build installers with electron-builder (release/)
npm test           # parser and orchestrator unit tests
npm run typecheck
```

On first launch the setup wizard scans your machine, suggests default models and asks for a default working folder.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New session |
| `Ctrl+P` | Open session |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+F` | Search sessions |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+,` | Settings |
| `Ctrl+L` | Focus prompt |
| `Alt+1` / `Alt+2` / `Alt+3` | Single / Analysis → Code / Parallel |

On macOS use `Cmd` instead of `Ctrl`.

## Architecture

```
src/
  shared/types.ts        types and the IPC contract shared by main and renderer
  main/
    index.ts             window and IPC handlers
    env.ts               PATH resolution (incl. login-shell PATH on macOS), executable lookup, process-tree kill
    providers.ts         CLI definitions: detection, auth check, model list, argument building
    parsers.ts           turns stream-json / JSONL / plain output into common events (pure, unit-tested)
    runner.ts            spawns one CLI process, streams output, handles cancel and timeout
    orchestrator.ts      run modes, approval gate, session resume, context history, git change tracking
    store.ts             JSON-backed settings and session store (userData/agenty)
  preload/index.ts       secure `window.agenty` API via contextBridge
  renderer/src/          React UI (activity bar, sidebar, session view, composer, wizard, settings, palette)
```

Prompts are passed to CLIs via **stdin**, which avoids Windows argument-escaping issues and command-line length limits. The renderer runs with `contextIsolation`, `sandbox` and no Node integration; model output is rendered as sanitized Markdown.

### Adding a CLI

Add an entry to `PROVIDERS` in `src/main/providers.ts` with `bins`, `checkAuth`, `listModels`, `build` and a `parser` (`claude-stream`, `codex-json` or `plain`). Then add its id to the `ProviderId` type and a color to `PROVIDER_COLORS`.

## Troubleshooting

- **A CLI isn't detected (macOS/Linux):** Agenty reads your login shell's `PATH`; if it still can't find the binary, set the path manually in *Settings → Providers*.
- **Codex: "model is not supported":** the default model in `~/.codex/config.toml` may not be available on your plan. Pick a model explicitly in Agenty (the list is read from `~/.codex/models_cache.json`).
- **Electron fails to start:** run `npm run postinstall` to download the Electron binary.
- **Extra CLI flags:** each provider accepts additional arguments in *Settings → Providers* (e.g. `--append-system-prompt "…"` for Claude Code).
