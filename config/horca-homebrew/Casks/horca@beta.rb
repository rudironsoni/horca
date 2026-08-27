# Horca beta — same Horca.app / com.rudironsoni.horca as stable. Homebrew
# versioned cask (conflicts with horca); not a third side-by-side product.
cask "horca@beta" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0-horca.0-beta.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg"
  name "Horca"
  desc "Personal downstream distribution of the Orca agent workbench (beta)"
  homepage "https://github.com/rudironsoni/orca"

  livecheck do
    url "https://github.com/rudironsoni/orca"
    regex(/^v(\d+(?:\.\d+)+-horca\.\d+-beta\.\d+)$/i)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]
        next unless release["prerelease"]

        match = release["tag_name"]&.match(regex)
        next if match.blank?

        match[1]
      end
    end
  end

  # No auto_updates: Horca's in-app updater is intentionally disabled; this
  # cask (or a GitHub Releases download) is the only update path.

  conflicts_with cask: "horca"
  depends_on macos: :big_sur

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
