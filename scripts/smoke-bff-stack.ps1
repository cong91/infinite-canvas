$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "..\docker-compose.bff.local.yml"
$composeArgs = @("compose", "-f", $composeFile, "-p", "infinite-canvas-bff")
$postgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "canvas" }
$postgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "canvas" }
$minioApiPort = if ($env:MINIO_API_PORT) { $env:MINIO_API_PORT } else { "19000" }
$bffPort = if ($env:CANVAS_BFF_PORT) { $env:CANVAS_BFF_PORT } else { "17372" }

docker @composeArgs config --quiet
docker @composeArgs ps

docker @composeArgs run --rm postgres-migrate
docker @composeArgs run --rm minio-init

function Wait-Http($uri) {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing $uri
            if ($response.StatusCode -eq 200) { return }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "Timed out waiting for $uri"
}

Wait-Http "http://127.0.0.1:$minioApiPort/minio/health/live"
Wait-Http "http://127.0.0.1:$bffPort/ready"

$schema = docker @composeArgs exec -T postgres psql -U $postgresUser -d $postgresDb -tAc "SELECT string_agg(to_regclass(table_name)::text, ',' ORDER BY table_name) FROM (VALUES ('canvas_accounts'), ('canvas_sessions'), ('canvas_providers'), ('canvas_projects'), ('canvas_assets'), ('canvas_generations')) AS tables(table_name);"
if ($schema.Trim() -ne "canvas_accounts,canvas_assets,canvas_generations,canvas_projects,canvas_providers,canvas_sessions") {
    throw "Canvas migration smoke failed: $($schema.Trim())"
}

Write-Output "BFF Docker smoke passed: PostgreSQL migrations, MinIO health, and Canvas BFF readiness."
