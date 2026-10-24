param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Files)
$env:DB_HOST='127.0.0.1'; $env:DB_PORT='3317'; $env:DB_USERNAME='root'; $env:DB_PASSWORD='root'; $env:DB_DATABASE='campusloop_test'
$env:TEST_DB_HOST='127.0.0.1'; $env:TEST_DB_PORT='3317'; $env:TEST_DB_USER='root'; $env:TEST_DB_PASSWORD='root'; $env:TEST_DB_NAME='campusloop_test'
npm run migration:run
npx vitest run --config vitest.config.e2e.ts @Files