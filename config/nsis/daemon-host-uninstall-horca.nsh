; Horca (downstream distribution) variant of daemon-host-uninstall.nsh.
;
; Why a separate file: NSIS includes are static, and each distribution's
; uninstaller must only ever kill and remove ITS OWN relocated terminal daemon.
; Sharing the official include would make uninstalling Horca destroy an
; installed Orca's live daemon (and vice versa), breaking side-by-side installs.
;
; The image name and the LOCALAPPDATA folder name must stay in sync with
; src/shared/distribution-identity.json (windowsTerminalDaemonImageName /
; windowsDaemonHostRootName) and daemon-host-relocation.ts. See the official
; include for the full relocation rationale and the ${isUpdated} guard.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'taskkill /F /IM horca-terminal-daemon.exe'
    ; Give the OS a moment to release the image lock before removing the tree.
    Sleep 500
    RMDir /r "$LOCALAPPDATA\Horca\daemon-host"
  ${endIf}
!macroend
