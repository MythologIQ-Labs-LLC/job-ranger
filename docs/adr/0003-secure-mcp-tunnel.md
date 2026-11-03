# ADR-0003: Opt-in Secure MCP Tunnel for single-user private development

**Status:** Accepted as development implementation path, pending a real authorized end-to-end ChatGPT connection  
**Date:** 2026-10-08  
**Depends on:** [ADR-0002 local read-only MCP boundary](./0002-local-readonly-mcp-boundary.md), [issue #173](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/173)

## Decision

For a user testing private Sojourner data in ChatGPT, **prefer OpenAI's official Secure MCP Tunnel with a local stdio MCP command**, not an improvised public HTTPS proxy. According to the current [OpenAI tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) and the official [tunnel-client stdio configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), the tunnel client can launch `--mcp.command` and forward MCP requests over an outbound-only HTTPS control-plane connection.

This is a deliberately limited **single-user development mode** for the user who controls both the Sojourner workspace and the authorized ChatGPT/tunnel configuration. It is **not** public plugin distribution, a shared-service deployment, or a replacement for authenticated per-user OAuth when distributing private multi-user capabilities. Tunnel association/permissions are independently configured on the OpenAI side; this repository does not issue or validate those identities.

## Implementation boundary

* `mcp/tunnel-operator.mjs` has an inspection-only default (`--mode=check`): no database records are read, no network connection is started, and no tunnel is provisioned.
* Private data transfer is fail-closed without **`--approve-private-data-transfer=yes`** and explicit named read scopes. An absolute native workspace path is required for data scopes.
* `--scopes=none` can be tested without a native workspace and exposes only `get_capabilities`. No implicit scopes or writes exist.
* Run mode requires the tunnel ID and control-plane runtime key **from environment variables**, not CLI arguments, generated config files, or source code. Operator errors avoid echoing either secret or user workspace path.
* The tunnel runs the constant command `node mcp/sanitized-stdio-launcher.mjs` with a fixed repository working directory. A dedicated launcher strips control-plane API keys, admin credentials, `NODE_OPTIONS`, and unrelated environment variables before invoking the previously implemented MCP server. The only Sojourner configuration passed to that server is the operator-fixed scope list and native data-directory path.
* The original MCP server still creates its read-only transaction-consistent SQLite snapshot, uses existing deterministic app services, and permits no writes, publication, jobs submitted, or model-driven approvals. MCP tool calls cannot change scopes, choose a different workspace, or execute arbitrary scripts.
* Tunnel-client's official stdio deployment limit is **one active tunnel-client instance per tunnel ID**. No auto-start daemon, persisted supervisor, or multiple-client replica is added. The operator runs in the foreground; stopping the session terminates forwarding. The official tunnel control-plane process, not Sojourner, owns outbound communications.

## Authorization and privacy limitations

A tunnel ID and runtime key **do not prove** that the ChatGPT user has authority over a specific native Sojourner workspace. A human must first inspect the tunnel's Platform organization and intended ChatGPT workspace, verify *Tunnels Read + Use* permissions and user access policy in the official control plane, then deliberately approve the listed read scopes locally. This architecture does not offer per-user, per-tool-call OAuth account binding, and must **never** be used to share a personal Career Ops database through a multi-user workspace or a tunnel that other people can access. A production/shared plugin requires an independently verified OAuth 2.1 provider, per-user scopes and resource/audience validation, revocation and access logs.

With private scopes enabled, an authorized ChatGPT interaction can cause selected career data to travel from the local process through the outbound tunnel to OpenAI. A local SQLite snapshot avoids uploading an entire database, **not** the transmission of requested tool results. The operator must accept the privacy implications and ChatGPT client retention separately. Stopping the process prevents future calls; it cannot delete data already returned to a conversation.

If the operator does not know whether the tunnel or workspace association is private, **do not enable any data scope**. Start with `--scopes=none`, review `get_capabilities`, and complete authorization checks first.

## Non-goals and next gate

We **do not** silently create an OpenAI Platform tunnel, acquire API keys, inspect someone else's account configuration, or register a ChatGPT plugin. Those steps require the user's credentials, user-approved workspace binding and explicit action. We also do not implement a new public HTTP listener, access server or custom OAuth flow just to make a prototype reachable.

The next verified completion criteria are:

1. Local CI proves command construction, configuration denial, no-data handshake and secret redaction. The existing stdio/SQLite tests remain green on Linux and Windows.
2. With the owner's actual workstation online and an authorized tunnel ID, the official `tunnel-client doctor` and runtime readiness checks pass.
3. An authorized ChatGPT user installs/selects the private tunnel plugin in ChatGPT and demonstrates `get_capabilities` with **no** data scope.
4. The owner reviews workspace access and deliberately opts into exactly one read scope; ChatGPT performs one permitted bounded read, one denied read and one denied mutation, with source SQLite unchanged.
5. Revocation is verified by stopping the tunnel and confirming that subsequent ChatGPT calls cannot reach the MCP server; unexpected credentials/tool results never appear in logs.

Only a witnessed successful ChatGPT plugin invocation satisfies the end-to-end connectivity gate. CI alone never establishes that a real ChatGPT connection is live.

See [operator instructions](../integrations/SOJOURNER_SECURE_TUNNEL.md) and official documentation:
* https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
* https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
* https://github.com/openai/tunnel-client/blob/master/docs/configuration.md
* https://developers.openai.com/plugins/deploy/connect-chatgpt
