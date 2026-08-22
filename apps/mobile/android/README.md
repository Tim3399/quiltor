# Android host

The Android host will bind `quiltor-core`, expose native bridge v1 to the shared
client, store secrets using Keystore-backed storage and represent external
documents as persisted Storage Access Framework URIs.

Authentication uses Custom Tabs/AppAuth and application writes are flushed on
lifecycle transitions. Google Play packaging lives under
`distribution/mobile/android`.
