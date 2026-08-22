# iOS App Store target

Status: **scaffold**. The distribution profile records the constraints now so
shared product code cannot assume subprocesses or unrestricted filesystem access.
No `.ipa` build is advertised before an iOS host and signed Xcode archive exist.

Activation requires an iOS host, portable core binding, document-provider tests,
StoreKit entitlement handling, privacy manifests, App Store signing and TestFlight
installation tests.
