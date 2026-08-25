# Horca — personal downstream distribution of Orca, installable side by
# side with the official Orca app (distinct app name, bundle id, protocol,
# CLI, and state root; see rudironsoni/orca docs/reference/horca-distribution.md).
cask "horca" do
  arch arm: "arm64", intel: "x64"

  version "1.4.178-horca.1"
  sha256 arm:   "9ce7f01743ef39bec28d3fe2bd5088fb82285f04082e6e987a557913ab9188b0",
         intel: "6d81181bfbb99f51f91c64329c3df871539fb68cddf6bc5f967337f6e472d0bc"

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
