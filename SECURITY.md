# Security Policy

## Reporting a Vulnerability

Please create a [Github Security Advisory](https://github.com/derpx06/webgenie/security/advisories/new)

## Known dependency advisories

`pnpm audit --prod` reports nine advisories after the 1.0.0 dependency update (down from 40, none critical). Each needs a
major-version jump the libraries above it do not yet allow, or has no fixed release. None is reachable from what the
extension does:

| Package | Why it is still listed | Why it does not apply |
| --- | --- | --- |
| `extract-zip`, `basic-ftp` | Pulled in by `puppeteer-core`'s Node-only browser downloader | The extension drives an already-running browser over `chrome.debugger`; it never downloads a browser, unpacks an archive or opens FTP |
| `langsmith` | Fixed only in 0.5 and 0.6, which the pinned LangChain does not accept yet | Tracing to LangSmith is off by default and used only with the user's own key and endpoint |
| `fast-xml-parser` | Fixed in 5.x; the AWS SDK under Bedrock still requires 4.x | Parses responses from the AWS endpoint the user configured, not page content |
| `uuid`, `zod` | Fixed in a new major | Used for ids and for validating the agent's own tool calls; no untrusted deserialization |

Everything else in the first audit is patched through `pnpm.overrides` in the root `package.json`. Re-run
`pnpm audit --prod` and review this table before each release.
