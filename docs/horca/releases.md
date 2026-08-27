# Horca releases

Horca has one tag-driven release workflow. A push to `main` does not publish anything.

- Stable tag: `v<orca-version>-horca.<N>`
- Beta tag: `v<orca-version>-horca.<N>-beta.<M>`

The workflow builds signed and notarized macOS DMGs and an unsigned Windows installer. It publishes one GitHub release, then updates `rudironsoni/homebrew-tap`:

- Stable updates `Casks/horca.rb`.
- Beta updates `Casks/horca@beta.rb`.

Required repository secrets:

- `MAC_CERTS`
- `MAC_CERTS_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `HOMEBREW_TAP_TOKEN`, with write access only to `rudironsoni/homebrew-tap`
- `HORCA_MAINTENANCE_TOKEN`, with access to push the sync branch and create pull requests

Create a release only after Horca CI is green:

```bash
git tag -a v1.2.3-horca.1 -m "Horca 1.2.3-horca.1"
git push origin v1.2.3-horca.1
```
