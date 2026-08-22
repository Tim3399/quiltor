# iOS host

The iOS host will bind `quiltor-core`, expose native bridge v1 to the shared
client, store secrets in Keychain and use document pickers/security-scoped URLs.
Authentication uses `ASWebAuthenticationSession`; lifecycle integration flushes
pending local writes before suspension.

Distribution metadata and signing configuration live under
`distribution/mobile/ios`, not in product modules.
