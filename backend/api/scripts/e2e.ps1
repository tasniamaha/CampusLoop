param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Files)
$env:DB_HOST='127.0.0.1'; $env:DB_PORT='3317'; $env:DB_USERNAME='root'; $env:DB_PASSWORD='root'; $env:DB_DATABASE='campusloop_test'
$env:TEST_DB_HOST='127.0.0.1'; $env:TEST_DB_PORT='3317'; $env:TEST_DB_USER='root'; $env:TEST_DB_PASSWORD='root'; $env:TEST_DB_NAME='campusloop_test'
# powershell -File exits 0 unless the script exits explicitly, so every failure must exit non-zero here.
npm run migration:run
if ($LASTEXITCODE -ne 0) { Write-Error "migration:run failed (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

# Vitest also writes a JSON summary. A run that stops without one (or with no tests) is a failure,
# even if the process exit code says otherwise.
$summary = Join-Path ([System.IO.Path]::GetTempPath()) "campusloop-e2e-$PID.json"
Remove-Item $summary -ErrorAction SilentlyContinue
npx vitest run --config vitest.config.e2e.ts --reporter=default --reporter=json "--outputFile.json=$summary" @Files
$code = $LASTEXITCODE
if ($code -ne 0) { Write-Error "vitest failed (exit $code)"; exit $code }
if (-not (Test-Path $summary)) { Write-Error 'vitest exited 0 but wrote no results summary'; exit 1 }
$result = Get-Content $summary -Raw | ConvertFrom-Json
Remove-Item $summary -ErrorAction SilentlyContinue
if (-not $result.success -or $result.numTotalTests -lt 1) {
  Write-Error "vitest reported success=$($result.success), tests=$($result.numTotalTests), failed=$($result.numFailedTests)"
  exit 1
}
Write-Host "e2e: $($result.numPassedTests) passed, $($result.numFailedTests) failed, $($result.numTodoTests) todo of $($result.numTotalTests)"
exit 0