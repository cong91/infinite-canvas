#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/infinite-canvas}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.ovh.yml}"
DOMAIN="${CANVAS_DOMAIN:-canvas.v-claw.org}"
MEDIA_DOMAIN="${CANVAS_MEDIA_DOMAIN:-media.canvas.v-claw.org}"
NGINX_SOURCE="${NGINX_SOURCE:-$APP_DIR/deploy/ovh-sing/nginx.canvas.v-claw.org.conf}"
NGINX_BOOTSTRAP_SOURCE="${NGINX_BOOTSTRAP_SOURCE:-$APP_DIR/deploy/ovh-sing/nginx.canvas.v-claw.org.bootstrap.conf}"
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN.conf"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

fail() { printf 'deploy preflight failed: %s\n' "$1" >&2; exit 1; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1; }
require_env() {
    local name="$1" value
    value="$(env_value "$name")"
    [ -n "${value//[[:space:]]/}" ] || fail "$name is missing from $ENV_FILE"
}
require_min_env() {
    local name="$1" minimum="$2" value
    value="$(env_value "$name")"
    [ "${#value}" -ge "$minimum" ] || fail "$name must contain at least $minimum characters"
}

[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE; create it from deploy/ovh-sing/env.production.example"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || fail "$ENV_FILE must have mode 600"
[ -f "$COMPOSE_FILE" ] || fail "missing $COMPOSE_FILE"
[ -f "$NGINX_SOURCE" ] || fail "missing $NGINX_SOURCE"
[ -f "$NGINX_BOOTSTRAP_SOURCE" ] || fail "missing $NGINX_BOOTSTRAP_SOURCE"
command -v docker >/dev/null || fail "docker is required"
docker compose version >/dev/null || fail "docker compose is required"
sudo -n true || fail "passwordless sudo is required for nginx and certbot"

for name in CANVAS_ORIGIN SUB2API_BASE_URL SUB2API_CANVAS_BFF_SECRET CANVAS_PROVIDER_MASTER_KEY CANVAS_OBJECT_SIGNING_SECRET POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET S3_PUBLIC_ENDPOINT; do
    require_env "$name"
done
require_min_env SUB2API_CANVAS_BFF_SECRET 32
require_min_env CANVAS_PROVIDER_MASTER_KEY 32
require_min_env CANVAS_OBJECT_SIGNING_SECRET 32
[ "$(env_value CANVAS_ORIGIN)" = "https://$DOMAIN" ] || fail "CANVAS_ORIGIN must be https://$DOMAIN"
[ "$(env_value S3_PUBLIC_ENDPOINT)" = "https://$MEDIA_DOMAIN" ] || fail "S3_PUBLIC_ENDPOINT must be https://$MEDIA_DOMAIN"
getent ahostsv4 "$DOMAIN" >/dev/null || fail "$DOMAIN has no resolvable A record; add DNS before deploying"
getent ahostsv4 "$MEDIA_DOMAIN" >/dev/null || fail "$MEDIA_DOMAIN has no resolvable A record; add DNS before deploying"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

if ! sudo test -s "$CERT_DIR/fullchain.pem" || ! sudo test -s "$CERT_DIR/privkey.pem"; then
    certbot_email="$(env_value CERTBOT_EMAIL)"
    [ -n "${certbot_email//[[:space:]]/}" ] || fail "CERTBOT_EMAIL is required for first certificate issuance"
    sudo install -d -m 755 /var/www/certbot
    sudo install -m 0644 "$NGINX_BOOTSTRAP_SOURCE" "$NGINX_AVAILABLE"
    sudo ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
    sudo nginx -t
    sudo systemctl reload nginx
    sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" -d "$MEDIA_DOMAIN" --non-interactive --agree-tos --email "$certbot_email" --keep-until-expiring
fi

sudo test -s "$CERT_DIR/fullchain.pem" || fail "TLS certificate was not issued for $DOMAIN"
sudo test -s "$CERT_DIR/privkey.pem" || fail "TLS private key was not issued for $DOMAIN"
sudo install -m 0644 "$NGINX_SOURCE" "$NGINX_AVAILABLE"
sudo ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
sudo nginx -t

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans
sudo systemctl reload nginx

curl --fail --retry 30 --retry-delay 2 --retry-all-errors --max-time 10 http://127.0.0.1:3000/ >/dev/null
curl --fail --retry 30 --retry-delay 2 --retry-all-errors --max-time 10 http://127.0.0.1:17372/ready >/dev/null
curl --fail --retry 30 --retry-delay 2 --retry-all-errors --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" >/dev/null
curl --fail --retry 30 --retry-delay 2 --retry-all-errors --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null
curl --fail --retry 30 --retry-delay 2 --retry-all-errors --max-time 10 --resolve "$MEDIA_DOMAIN:443:127.0.0.1" "https://$MEDIA_DOMAIN/minio/health/live" >/dev/null

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
printf 'deployed Canvas stack: https://%s (sha=%s)\n' "$DOMAIN" "${DEPLOY_SHA:-unknown}"
