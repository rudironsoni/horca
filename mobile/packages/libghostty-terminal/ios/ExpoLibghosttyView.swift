import ExpoModulesCore
import GhosttyTerminal
import UIKit

private final class OrcaTerminalView: TerminalView {
  var keyboardEnabled = false
  var onCleanTap: ((CGPoint) -> Void)?

  // Why: Fabric sizes Expo views from intrinsicContentSize; a Metal grid
  // width here keeps the terminal at ~half the pane and wraps at ~35 cols.
  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric)
  }

  override func toggleSoftwareKeyboard() {
    guard keyboardEnabled else { return }
    super.toggleSoftwareKeyboard()
  }

  @objc private func reportTap(_ recognizer: UITapGestureRecognizer) {
    onCleanTap?(recognizer.location(in: self))
  }

  func installTapReporter() {
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(reportTap))
    recognizer.cancelsTouchesInView = false
    addGestureRecognizer(recognizer)
  }
}

// Ghostty-backed terminal view. The JS side owns transport and session
// lifecycle; this view only renders bytes pushed via `write` and reports
// user input / grid resizes back through events.
class ExpoLibghosttyView: ExpoView {
  private let terminalView = OrcaTerminalView(frame: .zero)
  private var session: InMemoryTerminalSession?
  private var viewportColumns = 0
  private var viewportRows = 0

  private func makeSession() -> InMemoryTerminalSession {
    InMemoryTerminalSession(
      write: { [weak self] data in
        self?.onInput([
          "data": data.base64EncodedString(),
          "text": String(decoding: data, as: UTF8.self),
        ])
      },
      resize: { [weak self] viewport in
        self?.viewportColumns = Int(viewport.columns)
        self?.viewportRows = Int(viewport.rows)
        self?.onResize(["cols": viewport.columns, "rows": viewport.rows])
      }
    )
  }

  private func installSession(_ session: InMemoryTerminalSession) {
    self.session = session
    terminalView.configuration = TerminalSurfaceOptions(
      backend: .inMemory(session),
      fontSize: fontSize
    )
  }

  /// Base font size in points (nil → ghostty's default, 14). Changing it on a
  /// mounted view rebuilds the surface, which resets the grid — set it before
  /// mounting. Pinch-to-zoom steps from this value.
  var fontSize: Float? {
    didSet {
      guard fontSize != oldValue, let session else { return }
      terminalView.configuration = TerminalSurfaceOptions(
        backend: .inMemory(session),
        fontSize: fontSize
      )
    }
  }

  var keyboardEnabled: Bool {
    get { terminalView.keyboardEnabled }
    set { terminalView.keyboardEnabled = newValue }
  }

  /// Hosts keep inactive tabs mounted. `opacity: 0` does not hide CAMetalLayer,
  /// so a second surface paints beside the active one. Stop drawing and hide.
  var surfaceVisible = true {
    didSet {
      guard surfaceVisible != oldValue else { return }
      terminalView.isHidden = !surfaceVisible
      terminalView.setSurfaceVisible(surfaceVisible)
    }
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric)
  }

  /// Theme colors, applied through the shared controller's ghostty config —
  /// on iOS the theme is app-wide (every terminal view of the controller),
  /// unlike Android's per-view application. Colors accept ghostty config
  /// syntax; nil clears back to the defaults.
  func applyTheme(_ theme: TerminalThemeRecord?) {
    var config = TerminalConfiguration()
    if let theme {
      if let value = theme.background { config = config.background(value) }
      if let value = theme.foreground { config = config.foreground(value) }
      if let value = theme.cursorColor { config = config.cursorColor(value) }
      if let value = theme.selectionBackground { config = config.selectionBackground(value) }
      if let value = theme.selectionForeground { config = config.selectionForeground(value) }
      if let palette = theme.palette {
        for (index, color) in palette.enumerated() where index < 256 {
          if let color { config = config.palette(index, color: color) }
        }
      }
    }
    _ = TerminalController.shared.setTheme(TerminalTheme(light: config, dark: config))
  }

  let onInput = EventDispatcher()
  let onResize = EventDispatcher()
  let onBell = EventDispatcher()
  let onTitleChange = EventDispatcher()
  let onDirectoryChange = EventDispatcher()
  let onTap = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true

    let session = makeSession()
    // Without a controller the coordinator never builds a surface
    // ("surface rebuild skipped: missing controller").
    terminalView.controller = TerminalController.shared
    installSession(session)
    terminalView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // VoiceOver: one focusable element; direct interaction keeps touches
    // (taps, selection) flowing to the terminal instead of being swallowed.
    terminalView.isAccessibilityElement = true
    terminalView.accessibilityLabel = "Terminal"
    terminalView.accessibilityTraits = [.allowsDirectInteraction]
    terminalView.delegate = self
    terminalView.onCleanTap = { [weak self] point in self?.reportTap(at: point) }
    terminalView.installTapReporter()
    addSubview(terminalView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    terminalView.frame = bounds
    if bounds.width > 0, bounds.height > 0 {
      terminalView.fitToSize()
    }
  }

  /// Feed PTY output (terminal.output on the wire) into the grid.
  func write(_ data: Data) {
    session?.receive(data)
  }

  /// Feed PTY output as UTF-8 text, for string-based wires.
  func write(_ text: String) {
    session?.receive(text)
  }

  func reset(with text: String) {
    var data = Data([0x1b, 0x63, 0x1b, 0x5b, 0x33, 0x4a])
    data.append(contentsOf: text.utf8)
    session?.receive(data)
  }

  func paste(_ text: String) {
    _ = terminalView.paste(text: text)
  }

  private func reportTap(at point: CGPoint) {
    guard
      viewportColumns > 0,
      viewportRows > 0,
      terminalView.bounds.width > 0,
      terminalView.bounds.height > 0,
      let text = session?.readViewportText()
    else {
      onTap([:])
      return
    }
    let row = min(
      viewportRows - 1,
      max(0, Int(point.y / terminalView.bounds.height * CGFloat(viewportRows)))
    )
    let column = min(
      viewportColumns - 1,
      max(0, Int(point.x / terminalView.bounds.width * CGFloat(viewportColumns)))
    )
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    guard row < lines.count else {
      onTap([:])
      return
    }
    onTap(["lineText": String(lines[row]), "column": column])
  }

  /// Mark the underlying PTY as exited (terminal.exit on the wire).
  func finish(exitCode: UInt32) {
    session?.finish(exitCode: exitCode, runtimeMilliseconds: 0)
  }
}

// Terminal effects (OSC escapes) surfaced as component events.
extension ExpoLibghosttyView: TerminalSurfaceBellDelegate, TerminalSurfaceTitleDelegate,
  TerminalSurfacePwdDelegate {
  func terminalDidRingBell() {
    onBell([:])
  }

  func terminalDidChangeTitle(_ title: String) {
    onTitleChange(["title": title])
  }

  func terminalDidChangeWorkingDirectory(_ path: String) {
    onDirectoryChange(["path": path])
  }
}
