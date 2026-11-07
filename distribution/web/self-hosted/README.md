# Self-hosted web target

Status: **supported**. The repository `Dockerfile` is the build entrypoint and
the digest-bound image is the publication artifact. Release builds use only a
unique run/attempt/SHA hand-off tag; the authorized publish workflow promotes
the verified digest to the public version and `latest` tags together. Deployment-specific
configuration stays outside the image. Reverse-proxy examples live in `proxy/`;
the independently deployable backup endpoint lives under `services/backup-server/`.

Configuration is environment variables, documented in the repository README ("Docker and web
demo", "External AI endpoint") and in `.env.example`. A hosted instance signs people in with
Keycloak (realm `quiltor`, client scope `quiltor-roles` for the flat `roles` claim); the AI
assistant is for accounts with `QUILTOR_PREMIUM_ROLE` (default `premium`), with at most
`QUILTOR_ASSISTANT_MAX_OPEN_JOBS` open jobs each (default 3). An external OpenAI-compatible
provider is set with `QUILTOR_AI_URL`, `QUILTOR_AI_KEY` or `QUILTOR_AI_KEY_FILE`,
`QUILTOR_AI_MODEL_NAME` and, for Anthropic, `QUILTOR_AI_JSON_MODE=json_object`.
