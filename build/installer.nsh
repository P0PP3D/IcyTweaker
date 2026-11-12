; IcyTweaker uninstaller hook (spec, "Risks and legal": restore Defender if the app is uninstalled).
; Runs the app once with --restore-defender before files are removed. The app puts back only the Defender
; values it changed itself, from its live backup; if it never ran live, it changes nothing.
; Skipped when the uninstall is part of an update.
; Branded welcome page (the sidebar artwork is build/installerSidebar.bmp, made by scripts/installer-art.ps1).
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to IcyTweaker"
  !define MUI_WELCOMEPAGE_TEXT "IcyTweaker tunes Windows for gaming: tweaks, cleaning, Game Boost and game profiles.$\r$\n$\r$\nEvery change it makes is backed up and can be undone, and it creates a restore point before big changes.$\r$\n$\r$\nIt runs as administrator, so Windows asks for permission each time it starts.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --restore-defender'
  ${endIf}
!macroend
