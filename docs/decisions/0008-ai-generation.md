# 8. AI generation: local first, Anthropic opt-in

Date: 2026-11-04

## Status

Accepted

## Context

Q6 decided on a hybrid: a local model by default, a hosted API only when the user
opts in. M4 implements "Describe your system", so the details now matter: which
model and API features to use, how to get output that is always a valid map, where
the API key lives, and how to make it obvious where a description goes.

## Decision

- **Providers.** Ollama on this machine is the default (`qwen2.5:7b`,
  configurable). The Anthropic API is used only when the user selects it in AI
  settings and enters their own key.
- **Where it runs.** All model calls happen in the Electron main process. The
  renderer sends a description and receives a diagram; the key never reaches it.
- **Anthropic usage.** The official `@anthropic-ai/sdk`, model `claude-opus-5-5`
  (configurable), effort `medium`, structured outputs (`output_config.format`
  with the IR JSON schema), and server-side refusal fallback
  (`fallbacks: "default"`). `refusal` and `max_tokens` stops are handled
  explicitly; typed SDK errors become plain messages. Prompt caching is not used:
  requests are one-shot and the system prompt is near the minimum cacheable size.
- **One schema, one sanitizer.** Both providers are constrained by the same JSON
  schema (Ollama's `format`). The model produces only the semantic graph, never
  coordinates (ADR-0003). Every answer still goes through the sanitizer; an
  invalid one gets a single repair attempt with the error fed back.
- **Key storage.** Encrypted with the OS keychain through Electron `safeStorage`
  in the app's data folder. Where encryption is unavailable, the key is kept in
  memory for the session only, never written in plain text.
- **Transparency.** The Describe dialog always states where the description will
  be sent.

## Consequences

- With the default settings nothing leaves the machine; results depend on the
  local model, and the user must install Ollama and pull a model.
- Choosing the Anthropic API gives better maps at the user's cost, with a clear
  notice each time.
- Tests never call a real model: unit tests and E2E use local mock servers
  (`CRTGRPHR_ANTHROPIC_BASE_URL` is a test-only override).
