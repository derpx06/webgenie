# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Redesigned `AgentSight` live screen preview component to be a neat, floating circular button/icon that smoothly morphs/expands to a detailed viewport modal on click.

### Changed
- Removed the large, non-interactive `AgentSight` and `TabOrchestrator` layouts from blocking/cluttering the header and messages in the active chat view.
- Enabled SOTA Accessibility Tree (`axtree`) perception mode as the default browser perception mode to reduce DOM serialization payload size by 60-80%.
- Bypassed heavy page load and network-idle wait periods during sequential actions in single-turn batches using a new `skipNetworkIdle` parameter.
- Reduced the default inter-action delay from 500ms to 150ms and adjusted default page load timings for faster execution.
