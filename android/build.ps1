# Builds the game's APK without Android Studio: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Same script for every game: the app name comes from AndroidManifest.xml (package ru.<app>.app).
# Tools (JDK 17 + Android SDK) live in C:\Users\danil\android-build. Run build_apk.bat.
$ErrorActionPreference = 'Stop'
$tools = 'C:\Users\danil\android-build'
$jdk = (Get-ChildItem "$tools\jdk-*" -Directory | Select-Object -First 1).FullName
$sdk = "$tools\sdk"
$bt = "$sdk\build-tools\34.0.0"
$jar = "$sdk\platforms\android-34\android.jar"
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"

$here = $PSScriptRoot              # ...\android
$game = Split-Path $here -Parent   # game folder: index.html, *.js, icons
$manifest = [IO.File]::ReadAllText("$here\AndroidManifest.xml")
$app = [regex]::Match($manifest, 'package="ru\.([a-z]+)\.app"').Groups[1].Value
# aapt2 does not like non-latin paths, so everything is built in a latin-named folder
$work = "$tools\work-$app"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force "$work\assets\icons", "$work\assets\vendor", "$work\res", "$work\gen", "$work\classes", "$work\dex" | Out-Null

function Run($exe) {
  & $exe @args
  if ($LASTEXITCODE -ne 0) { throw "failed: $exe $args" }
}

# the game's files: page, scripts (the service worker is not needed in the app), icons
$js = Get-ChildItem "$game\*.js" | Where-Object { $_.Name -ne 'sw.js' }
Copy-Item "$game\index.html", "$game\manifest.webmanifest" "$work\assets\"
$js | Copy-Item -Destination "$work\assets\"
Copy-Item "$game\icons\*.png" "$work\assets\icons\"
Copy-Item "$here\vendor\*.js" "$work\assets\vendor\"
Copy-Item "$here\res\*" "$work\res\" -Recurse
Copy-Item "$here\AndroidManifest.xml" "$work\"
Copy-Item "$here\src" "$work\src" -Recurse

# version from the game: const APP_VER='2.5' (or VERSION) -> versionName 2.5, versionCode 205
$text = (@("$game\index.html") + $js.FullName | ForEach-Object { [IO.File]::ReadAllText($_) }) -join "`n"
$ver = [regex]::Match($text, "const (?:APP_VER|VERSION)='([^']+)'").Groups[1].Value
$p = $ver.Split('.')
$code = [int]$p[0] * 100 + $(if ($p.Length -gt 1) { [int]$p[1] } else { 0 })
Write-Host "$app $ver (code $code)"

Run "$bt\aapt2.exe" compile --dir "$work\res" -o "$work\res.zip"
Run "$bt\aapt2.exe" link -o "$work\base.apk" -I $jar --manifest "$work\AndroidManifest.xml" `
  --min-sdk-version 24 --target-sdk-version 34 --version-code $code --version-name $ver `
  --java "$work\gen" "$work\res.zip"

$srcs = Get-ChildItem "$work\src", "$work\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
Run "$jdk\bin\javac.exe" -nowarn "-Xlint:-options" -source 8 -target 8 -encoding UTF-8 -bootclasspath "$jar;$bt\core-lambda-stubs.jar" -d "$work\classes" @srcs
$classes = Get-ChildItem "$work\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
Run "$bt\d8.bat" --release --min-api 24 --lib $jar --output "$work\dex" @classes

# add classes.dex and the game files (aapt2 -A on Windows writes paths with "\" that Android cannot open)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open("$work\base.apk", 'Update')
[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$work\dex\classes.dex", 'classes.dex') | Out-Null
Get-ChildItem "$work\assets" -Recurse -File | ForEach-Object {
  $name = 'assets/' + $_.FullName.Substring("$work\assets\".Length).Replace('\', '/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name) | Out-Null
}
$zip.Dispose()

Run "$bt\zipalign.exe" -f -p 4 "$work\base.apk" "$work\aligned.apk"

# the same key must sign every version, otherwise Android will not install the update over the old one
$ks = "$here\$app-release.keystore"
if (-not (Test-Path $ks)) {
  Run "$jdk\bin\keytool.exe" -genkeypair -keystore "$work\new.keystore" -alias $app -keyalg RSA -keysize 2048 -validity 36500 `
    -storepass $app -keypass $app -dname "CN=$app, O=3forwork11235"
  Copy-Item "$work\new.keystore" $ks
}
Copy-Item $ks "$work\key.keystore"
Run "$bt\apksigner.bat" sign --ks "$work\key.keystore" --ks-pass "pass:$app" --key-pass "pass:$app" --out "$work\signed.apk" "$work\aligned.apk"
Run "$bt\apksigner.bat" verify "$work\signed.apk"

$out = "$here\$app-$ver.apk"
Copy-Item "$work\signed.apk" $out -Force
Write-Host "APK: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"

# a copy for sharing: <Desktop>\android games apk\<game name>-<version>.apk
$label = [regex]::Match($manifest, 'android:label="([^"]+)"').Groups[1].Value
$share = Join-Path ([Environment]::GetFolderPath('Desktop')) 'android games apk'
New-Item -ItemType Directory -Force $share | Out-Null
Get-ChildItem $share -Filter "$label-*.apk" | Remove-Item  # old versions of this game
Copy-Item $out (Join-Path $share "$label-$ver.apk")
Write-Host "Copy: $share\$label-$ver.apk"
