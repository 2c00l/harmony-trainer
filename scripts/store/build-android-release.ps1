$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$keyDirectory = Join-Path $env:USERPROFILE 'Keystores'
$env:HT_KEYSTORE = Join-Path $keyDirectory 'harmony-trainer-upload.keystore'
$passwordFile = Join-Path $keyDirectory 'harmony-trainer-upload.secret'
if (!(Test-Path -LiteralPath $env:HT_KEYSTORE) -or !(Test-Path -LiteralPath $passwordFile)) { throw 'Prepare the app upload key first.' }
$securePassword = Get-Content -LiteralPath $passwordFile | ConvertTo-SecureString
$env:HT_KEY_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location (Join-Path $projectDirectory 'android')
try {
    & .\gradlew.bat :app:assembleDebug :app:assembleRelease :app:bundleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
} finally {
    Pop-Location
    Remove-Item Env:\HT_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\HT_KEYSTORE -ErrorAction SilentlyContinue
}
