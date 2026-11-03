# Secure MCP Tunnel: owner-operated ChatGPT integration trial

**Status:** Developer-only connection preparation. The official tunnel integration is implemented behind local consent gates, but there is **no live or installed Sojourner ChatGPT plugin** verified as of 2026-10-08. The repository never creates a tunnel, stores OpenAI API keys, installs a ChatGPT plugin, or starts a background service.

This path is for a **single person who controls both the private Sojourner workspace and the ChatGPT account/tunnel binding**, not a shared team server. Public plugin distribution and multi-user per-account authentication remain outside this implementation.

## Why this path

OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) provides an official outbound-only connection to private MCP servers, including **stdio** commands. Sojourner already has a read-only local stdio server that delegates to canonical application services. This avoids a new public web listener or hosted career database. A local backup/snapshot does not prevent allowed tool results from reaching ChatGPT.

The tunnel-client is a separately downloaded **official OpenAI binary**; do not install an unknown executable advertised as a tunnel or copy credentials from chat. Follow [OpenAI's official tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md). This repository does not bundle tunnel binaries.

## Before enabling private data

1. On **your own** workstation, use a trusted checkout of Sojourner current `main`, Node 22.12+, `npm ci` and `npm run desktop:compile`.
2. Confirm you are using the **native** Sojourner SQLite data root; the browser PWA OPFS workspace is not available to this adapter. Take a regular Sojourner backup before your first test.
3. Download the official `tunnel-client` for your OS from the current [OpenAI release](https://github.com/openai/tunnel-client/releases/latest), confirm its signature/release provenance, and place it on your PATH. Do not hardcode a release artifact URL.
4. Create or locate an OpenAI Secure MCP Tunnel **in your own Platform organization** and explicitly associate it with the ChatGPT workspace that will use it. Check the workspace's plugin installation and **Tunnels Read + Use** permissions. The local operator cannot introspect or enforce that OpenAI-side association.
5. **Do not use private data scopes if anybody else can invoke this tunnel or plugin.** The prototype lacks per-user OAuth identity binding, so it is only approved for owner-controlled, single-user development.
6. Obtain the tunnel's runtime API key and tunnel ID from OpenAI's control plane. Do not paste them into chat, source code, an issue, a GitHub Actions secret, or CLI arguments. Use a secure OS secret store or temporary process environment; do not confuse admin keys with runtime keys.

Official tunnel-client supports a stdio binding via `--mcp.command`. Run **one** active tunnel client per tunnel ID. Running two instances can split MCP session initialization from later calls and is unsupported.

## No-data probe first

Compile the existing native backend and test the local adapter:

```sh
npm ci
npm run desktop:compile
npm run test:mcp:readonly
npm run test:mcp:tunnel
```

Set `CONTROL_PLANE_API_KEY` and `CONTROL_PLANE_TUNNEL_ID` in your shell environment using your platform's secure credential workflow. These examples intentionally **do not show token values**.

Start with the following read-only checks; the first command never starts forwarding:

```sh
node mcp/tunnel-operator.mjs --mode=check --scopes=none
```

Once the official tunnel association is verified by the owner, enable **no-data, foreground tunnel mode**:

```sh
node mcp/tunnel-operator.mjs --mode=run --scopes=none
```

The operator launches the official `tunnel-client run`, binding `node mcp/sanitized-stdio-launcher.mjs` as its only `main` MCP command. The launcher strips tunnel API keys before starting the Sojourner server. It does **not** open a public port, start a separate proxy or invent a new OAuth server. Stop it with Ctrl+C before changing permissions.

On a second trusted local terminal, follow `tunnel-client doctor` and the official health/ready diagnostics for your installed release. The default health/admin listener is loopback-only; do not broaden it to `0.0.0.0`.

With the foreground tunnel running, open **ChatGPT Web → Plugins → Add custom MCP server → Connection: Tunnel** and choose your previously verified owner-controlled tunnel ID. Configure the identity/permission choice offered by ChatGPT, review the warning and install the private plugin. Select it from a new conversation and call `get_capabilities`. It must report **no granted data scopes**, **no write tools**, and no database snapshot time.

If ChatGPT cannot discover or initialize the server, **do not change to a public no-auth endpoint** as a workaround. Check workspace association, tunnel health, the stdio initialization handshake, and the official supported client/runtime. A live successful call must be witnessed before recording ChatGPT integration as working.

## Deliberately enable a minimal private read

Only after the owner has verified the workspace/tunnel mapping and no-data call:

```sh
node mcp/tunnel-operator.mjs --mode=check \
  --scopes=posts:read \
  --data-dir="/ABSOLUTE/PATH/TO/NATIVE/SOJOURNER_DATA"
```

If the check is clean and you explicitly approve the transfer of bounded **publication metadata** to the authorized ChatGPT environment, stop the no-data tunnel and restart once with:

```sh
node mcp/tunnel-operator.mjs --mode=run \
  --scopes=posts:read \
  --data-dir="/ABSOLUTE/PATH/TO/NATIVE/SOJOURNER_DATA" \
  --approve-private-data-transfer=yes
```

The user-visible approval is a local process consent boundary, not a substitute for OAuth in shared deployments. Grant additional scopes only after validating their minimized outputs. **`post-content:read`** includes exact approved post text and should be considered more sensitive; **`evidence:read`** exposes limited personal work-history statements.

In ChatGPT, run an explicit bounded positive tool test, a request for an ungranted tool, and an attempted `create_post_draft`. The latter two must be denied. Verify that no canonical data has changed, no raw API token appears in logs or result text, and that post text is always treated as untrusted input.

Stop the tunnel and verify a new remote call fails. A revoked connection cannot erase already delivered ChatGPT conversation content. Remove the custom plugin or revoke its OpenAI-side tunnel association if you no longer want access.

## Operator commands

| Command | Effect |
| --- | --- |
| `--mode=check --scopes=none` | Offline no-data configuration review |
| `--mode=run --scopes=none` | Starts official outbound tunnel exposing `get_capabilities` only |
| `--mode=check --scopes=posts:read --data-dir=...` | Verifies local prerequisites; no data export or tunnel launch |
| `--mode=run --scopes=posts:read --data-dir=... --approve-private-data-transfer=yes` | Owner-consented foreground tunnel exposing only publication metadata |
| `--tunnel-bin=/absolute/path/to/tunnel-client` | Optional explicit official binary location when it is not on PATH |

Both run modes require the **environment-provided** `CONTROL_PLANE_API_KEY` and `CONTROL_PLANE_TUNNEL_ID`. The operator does not create or modify these resources. No token should be passed as a command argument. On Windows, use PowerShell continuation syntax instead of the shell line-continuation characters shown above, or keep each command on one line.

## Security claims we can and cannot make

**Already covered by automated tests:** fixed scopes; nonexistent/duplicate scope refusal; explicit approval for private reads; missing workspace/config refusal; no-data handshake; independent read-only SQLite snapshot; read-only tool catalog; secret sanitization between tunnel-client and Sojourner subprocess; absence of shell interpolation in the fixed MCP command.

**Not yet proven by CI:** actual installed official tunnel-client across supported OSes; ChatGPT plugin creation; OpenAI workspace association, per-user tool access controls, OAuth; network-level tunnel identity; shutdown and remote-revocation behavior; confidential data retained in conversation history. Those require authorized real-world account and device verification.

The reference [ADR-0003](../adr/0003-secure-mcp-tunnel.md) is the governing decision. Follow-up work continues in [issue #173](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/173).

Official docs:
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/configuration.md
- https://developers.openai.com/plugins/deploy/connect-chatgpt
