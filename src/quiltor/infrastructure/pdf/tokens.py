"""Short-lived, single-use tokens that let a headless render act as the
requesting user for exactly one page load.

The hosted deployment is what needs them: the render runs in a separate browser
process with no cookie of its own, and it cannot do an interactive Keycloak
login. A single-user instance would usually recognise that process anyway --
it connects over loopback -- but the token path is common to both identities
rather than conditional, so the render URL is built the same way everywhere.
The renderers know none of this; they carry whatever URL they are given.
"""

RENDER_TOKEN_TTL = 90
