# Generates the installer artwork from build/icon.png (run: powershell -File scripts/installer-art.ps1).
#   build/installerSidebar.bmp   164x314  welcome / finish pages (also used for the uninstaller)
#   build/installerHeader.bmp    150x57   top-right banner on the other pages
# 24-bit BMP, as NSIS requires. Colours match the app (near-black panel, ice-blue accent).
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'build\icon.png'))

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
  return @($bmp, $g)
}

# Sidebar: dark gradient, soft ice glow, logo, name, tagline.
$bmp, $g = New-Canvas 164 314
$rect = New-Object System.Drawing.Rectangle(0, 0, 164, 314)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(5, 6, 9), [System.Drawing.Color]::FromArgb(10, 31, 56), 90)
$g.FillRectangle($bg, $rect)
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath; $glow.AddEllipse(-40, 40, 244, 180)
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$pg.CenterColor = [System.Drawing.Color]::FromArgb(90, 56, 189, 248); $pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 56, 189, 248))
$g.FillPath($pg, $glow)
$g.DrawImage($icon, 42, 70, 80, 80)
$white = [System.Drawing.Brushes]::White
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'
$g.DrawString('IcyTweaker', (New-Object System.Drawing.Font('Segoe UI Semibold', 15)), $white, (New-Object System.Drawing.RectangleF(0, 168, 164, 30)), $fmt)
$sub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(148, 197, 230))
$g.DrawString("Tweaks and cleaning`nfor gamers", (New-Object System.Drawing.Font('Segoe UI', 8.5)), $sub, (New-Object System.Drawing.RectangleF(0, 200, 164, 44)), $fmt)
$line = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 56, 189, 248), 1)
$g.DrawLine($line, 40, 252, 124, 252)
$g.Dispose(); $bmp.Save((Join-Path $root 'build\installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()

# Header: dark strip, small logo, name.
$bmp, $g = New-Canvas 150 57
$rect = New-Object System.Drawing.Rectangle(0, 0, 150, 57)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(10, 31, 56), [System.Drawing.Color]::FromArgb(5, 6, 9), 0)
$g.FillRectangle($bg, $rect)
$g.DrawImage($icon, 10, 12, 33, 33)
$g.DrawString('IcyTweaker', (New-Object System.Drawing.Font('Segoe UI Semibold', 11)), $white, 48, 17)
$g.Dispose(); $bmp.Save((Join-Path $root 'build\installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()
$icon.Dispose()
'Wrote build\installerSidebar.bmp and build\installerHeader.bmp'
