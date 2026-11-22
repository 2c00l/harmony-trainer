$ErrorActionPreference = 'Stop'
$keyDirectory = Join-Path $env:USERPROFILE 'Keystores'
$keyPath = Join-Path $keyDirectory 'harmony-trainer-upload.keystore'
$passwordPath = Join-Path $keyDirectory 'harmony-trainer-upload.secret'
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $passwordPath)) {
    if ((Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $passwordPath)) { Write-Output 'The Harmony Trainer upload key is already present.'; exit 0 }
    throw 'Incomplete existing signing material. Refusing to replace it.'
}
$password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$securePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordPath
$env:HT_KEY_PASSWORD = $password
try {
    & 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -genkeypair -keystore $keyPath -storetype PKCS12 -alias harmony-trainer-upload -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Charlie Sendrowski, O=Study Music Theory, C=GB' -storepass:env HT_KEY_PASSWORD -keypass:env HT_KEY_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Upload key generation failed.' }
    & 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -exportcert -rfc -keystore $keyPath -alias harmony-trainer-upload -storepass:env HT_KEY_PASSWORD -file (Join-Path $keyDirectory 'harmony-trainer-upload-certificate.pem')
    if ($LASTEXITCODE -ne 0) { throw 'Upload certificate export failed.' }
} finally {
    Remove-Item Env:\HT_KEY_PASSWORD -ErrorAction SilentlyContinue
    $password = $null
}
Write-Output 'Created the app upload key. The password is protected by Windows for this user.'
