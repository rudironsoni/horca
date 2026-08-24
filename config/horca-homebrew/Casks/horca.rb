# Horca — personal downstream distribution of Orca, installable side by
# side with the official Orca app (distinct app name, bundle id, protocol,
# CLI, and state root; see rudironsoni/orca docs/reference/horca-distribution.md).
#
# BOOTSTRAP: version and sha256 below are placeholders until the first
# Horca release exists on rudironsoni/orca. Fill them manually once
# (shasum -a 256 <dmg>), or run the bump-horca-cask workflow; afterwards
# the scheduled bump workflow keeps them current.
cask "horca" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0-horca.0" # REPLACE_WITH_FIRST_RELEASE
  sha256 arm:   "REPLACE_WITH_ARM64_SHA256",
         intel: "REPLACE_WITH_X64_SHA256"

  url "https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg"
  name "Horca"
  desc "Personal downstream distribution of the Orca agent workbench"
  homepage "https://github.com/rudironsoni/orca"

  livecheck do
    url :url
    regex(/^v(\d+(?:\.\d+)+-horca\.\d+)$/i)
    strategy :github_latest
  end

  # No auto_updates: Horca's in-app updater is intentionally disabled; this
  # cask (or a GitHub Releases download) is the only update path.

  depends_on macos: ">= :big_sur"

  app "Horca.app"
  binary "#{appdir}/Horca.app/Contents/Resources/bin/horca"

  # Zap removes ONLY Horca-owned state, keyed on the Horca bundle id and
  # product name. Official Orca's app, ~/.orca, Application Support/Orca,
  # Keychain items, caches, preferences, and TCC grants must survive a zap.
  # Paths must be re-verified against a real install before first publication
  # (Phase 2 human acceptance) — never copy Orca's zap stanza.
  zap trash: [
    "~/.horca",
    "~/Library/Application Support/Horca",
    "~/Library/Caches/com.rudironsoni.horca",
    "~/Library/Caches/com.rudironsoni.horca.ShipIt",
    "~/Library/HTTPStorages/com.rudironsoni.horca",
    "~/Library/Preferences/com.rudironsoni.horca.plist",
    "~/Library/Saved Application State/com.rudironsoni.horca.savedState",
  ]
end
