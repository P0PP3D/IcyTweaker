; IcyTweaker uninstaller hook (spec, "Risks and legal": restore Defender if the app is uninstalled).
; Runs the app once with --restore-defender before files are removed. The app puts back only the Defender
; values it changed itself, from its live backup; if it never ran live, it changes nothing.
; Skipped when the uninstall is part of an update.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --restore-defender'
    ; The app's scheduled tasks (no-prompt Open from the shortcuts, Start with Windows). Missing ones are fine.
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN "\IcyCleaner\Open" /F'
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN "\IcyCleaner\Start" /F'
  ${endIf}
!macroend
