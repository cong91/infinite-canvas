#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 --command "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);"

for migration in /migrations/*.sql; do
    version=$(basename "$migration" .sql)
    case "$version" in
        *[!A-Za-z0-9_-]*)
            echo "Invalid migration filename: $version" >&2
            exit 1
            ;;
    esac

    if psql --tuples-only --no-align --command "SELECT 1 FROM schema_migrations WHERE version = '$version'" | grep -qx 1; then
        continue
    fi

    temporary_sql=$(mktemp)
    trap 'rm -f "$temporary_sql"' EXIT
    cat "$migration" > "$temporary_sql"
    printf "\nINSERT INTO schema_migrations(version) VALUES ('%s');\n" "$version" >> "$temporary_sql"
    psql --set ON_ERROR_STOP=1 --single-transaction --file "$temporary_sql"
    rm -f "$temporary_sql"
    trap - EXIT
done
