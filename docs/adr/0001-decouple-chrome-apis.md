# Decouple Chrome Extension APIs via IBrowserAdapter

## Context
Standard Chrome Extension background scripts reference global `chrome.*` APIs directly, which makes them difficult to unit-test and ties them tightly to the extension runtime. We needed a way to test background services (such as DOM scanning, page management, and CDP interaction) in non-extension environments (like Node.js unit test runner suites).

## Decision
We abstract all browser-native API calls into the `IBrowserAdapter` interface and inject it via constructors into the core browser control classes (`BrowserContext`, `Page`, etc.). Similarly, data persistence is decoupled using the `IStorageProvider` interface.

## Consequences
- Core modules are environment-agnostic and fully mockable during unit tests.
- Background services are decoupled from extension lifecycle dependencies.
- Added minor interface implementation overhead for runtime Chrome bindings.
