# Own AI

The assistant can have an answer computed in two ways:

- **Server AI:** the model you set up on the server as its operator (the local runtime or an
  external OpenAI-compatible endpoint, see [The local assistant](../assistant.md)). On a
  multi-user server an account needs the premium role for it (`QUILTOR_PREMIUM_ROLE`).
- **AI in the browser (WebLLM):** a model that runs in the user's own browser, on their own
  graphics card (WebGPU). The server builds the prompt and checks the answer just as it does
  for the server AI; only the computing happens in the browser. It needs neither the premium
  role nor a model on the server.

An own key for a cloud provider is planned for a later version. This version has none.

## Switching it on and off

`QUILTOR_ASSISTANT_CLIENT_AI` decides whether jobs may run on the user's own AI.

| Value           | Effect                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| empty or `1`    | on (default)                                                                                                                                                                                                          |
| `0`             | off: `GET /api/capabilities` reports `instance.clientAi: false`, `GET /api/assistant/status` reports no `clientEngines`, and a job on an own AI as well as the relay routes answer `403 assistant.client_ai_disabled` |
| any other value | The start stops.                                                                                                                                                                                                      |

`QUILTOR_ASSISTANT_CLIENT_JOBS` limits how many such jobs one process runs at once. Each
account has at most one at a time.

## Deadlines

The server hands every model call to the browser and waits for its answer. The deadlines for
that can be set. A value outside the bounds stops the start, with a message naming the
variable and its bounds.

| Variable                                        | Meaning                                       | Default | Bounds     |
| ----------------------------------------------- | --------------------------------------------- | ------- | ---------- |
| `QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM` | seconds for one answer of the in-browser AI   | 300     | 30 to 3600 |
| `QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD`  | seconds for one answer of a cloud provider    | 120     | 10 to 600  |
| `QUILTOR_ASSISTANT_RELAY_JOB_MINUTES`           | minutes for a whole job, across all its calls | 20      | 1 to 120   |

A slow machine needs more time per answer for a large model. Raise the WebLLM deadline then,
rather than letting the whole job run longer.

## Behind a reverse proxy

The browser fetches its calls from `/api/assistant/relay/next`. The request stays open for up
to 25 seconds until a call is ready, so the proxy's read timeout must be 30 seconds or more.
The nginx default (`proxy_read_timeout 60s`) and Caddy's default are enough. If you set a value
of your own, keep it at 30 seconds or more.

An answer from the browser (`/api/assistant/relay/answer`) may be at most 256 KiB. Quiltor's
own client checks that before sending. A foreign client that sends more is refused without the
rest being read. Depending on the system, that client then sees an aborted connection instead
of `413` (on Windows, error 10053 for instance). That is deliberate: the server reads no
unbounded data just to deliver a refusal politely.

## Content Security Policy and the model download

The in-browser AI downloads its model from Hugging Face the first time, and its model
libraries from GitHub. For that the policy allows exactly these hosts in `connect-src`:

- `https://huggingface.co`: the model index and metadata.
- `https://*.cdn.hf.co`: the model files. Hugging Face serves them through regional CDN hosts
  such as `us.aws.cdn.hf.co` or `eu-west-3.aws.cdn.hf.co` and itself calls these hosts subject
  to change. A fixed list would break on every change, and first for users in other regions.
  This is the policy's only wildcard.
- `https://cdn-lfs-us-1.hf.co` and `https://cdn-lfs-eu-1.hf.co`: older storage hosts for large
  files.
- `https://raw.githubusercontent.com`: the model libraries (`.wasm`).

Hugging Face's xethub hosts (`cas-bridge.xethub.hf.co`, for instance) are left out on purpose.
They were not seen during the download and no longer appear in Hugging Face's host table.

Because Hugging Face can change its hosts, there is a way out if the download fails on the
policy (visible as a CSP violation in the browser console):

```bash
QUILTOR_CSP_CONNECT_EXTRA="https://new-host.example.org"
```

The variable takes `https://` origins without path and without wildcard, separated by spaces,
and appends them to `connect-src`. As a last resort, `QUILTOR_CSP=report-only` only reports
violations instead of blocking them.

## Audit

Every assistant answer is recorded with the kind of engine that computed it: `server`,
`webllm` or `cloud`. It is the first step of the answer's trace (`agentTrace`) and the field
`engine` of the world's interaction log. A model name or a key is never stored. Entries
recorded before this version count as `server`.
