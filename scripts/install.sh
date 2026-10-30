#!/usr/bin/env bash
#
# NodePanel — installer untuk VPS Ubuntu 22.04 / 24.04.
# Jalankan dengan: sudo ./scripts/install.sh
#
# Yang dilakukan:
#   1. Dependensi sistem (Node.js LTS, MySQL, Nginx, Redis, Certbot, PM2, UFW)
#   2. User khusus `nodepanel` (panel TIDAK boleh jalan sebagai root)
#   3. .env dengan secret acak + build frontend
#   4. Migrasi database + seed akun admin
#   5. Nginx: serve frontend (frontend/dist) di port 80 + reverse proxy
#      /api & /socket.io → 127.0.0.1:2087 (panel bisa dibuka lewat http://<IP>/)
#   6. Sudoers terbatas (nginx/systemctl/certbot)
#   7. PM2 service + startup, self-signed SSL, UFW (2087/80/443)
#
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/nodepanel}"
PANEL_USER="nodepanel"
PANEL_PORT="2087"

log()  { printf '\033[1;34m[nodepanel]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Jalankan dengan sudo: sudo ./scripts/install.sh"
[[ -d "$PANEL_DIR/backend" ]] || fail "Tidak menemukan $PANEL_DIR/backend — clone repo dulu ke $PANEL_DIR."

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- 1. Dependensi
log "Menginstal dependensi sistem..."
apt-get update -y
apt-get install -y curl ca-certificates git ufw jq unzip \
  nginx mysql-server redis-server certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  log "Memasang Node.js LTS (20.x)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2 >/dev/null

# ---------------------------------------------------------------- 2. User panel
if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
  log "Membuat user $PANEL_USER..."
  useradd -m -s /bin/bash "$PANEL_USER"
fi
chown -R "$PANEL_USER":"$PANEL_USER" "$PANEL_DIR"

# ---------------------------------------------------------------- 3. Environment
if [[ ! -f "$PANEL_DIR/backend/.env" ]]; then
  log "Membuat backend/.env dengan secret acak..."
  cp "$PANEL_DIR/backend/.env.example" "$PANEL_DIR/backend/.env"

  ACCESS_SECRET=$(openssl rand -hex 32)
  REFRESH_SECRET=$(openssl rand -hex 32)
  CRYPTO_KEY=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 18)

  sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${ACCESS_SECRET}|"       "$PANEL_DIR/backend/.env"
  sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${REFRESH_SECRET}|"   "$PANEL_DIR/backend/.env"
  sed -i "s|^PANEL_CRYPTO_KEY=.*|PANEL_CRYPTO_KEY=${CRYPTO_KEY}|"           "$PANEL_DIR/backend/.env"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=mysql://nodepanel:${DB_PASSWORD}@127.0.0.1:3306/nodepanel|" "$PANEL_DIR/backend/.env"
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|"                              "$PANEL_DIR/backend/.env"
  # PANEL_URL/WEB_ORIGIN di-set pada blok "Origin panel" di bawah.
  sed -i "s|^PANEL_DRY_RUN=.*|PANEL_DRY_RUN=|"                              "$PANEL_DIR/backend/.env"
  chmod 600 "$PANEL_DIR/backend/.env"
fi
# .env dibuat oleh root di atas, padahal build & seed dijalankan sebagai $PANEL_USER
chown "$PANEL_USER":"$PANEL_USER" "$PANEL_DIR/backend/.env"
chmod 600 "$PANEL_DIR/backend/.env"

# Origin panel dipakai untuk CORS (WEB_ORIGIN) dan link (PANEL_URL).
# Nginx menyajikan frontend pada origin yang sama dengan API, jadi keduanya
# harus menunjuk ke alamat yang benar-benar dipakai browser.
# Override bila pakai domain: sudo PANEL_URL=https://panel.example.com ./scripts/install.sh
if [[ -z "${PANEL_URL:-}" ]]; then
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") print $(i+1)}' | head -n1)"
  fi
  PANEL_URL="http://${SERVER_IP:-127.0.0.1}"
fi
WEB_ORIGIN="${WEB_ORIGIN:-$PANEL_URL}"

set_env() { # set_env KEY VALUE FILE — update baris KEY= atau tambahkan bila belum ada
  if grep -qE "^$1=" "$3"; then
    sed -i "s|^$1=.*|$1=$2|" "$3"
  else
    printf '%s=%s\n' "$1" "$2" >>"$3"
  fi
}
set_env PANEL_URL   "$PANEL_URL"  "$PANEL_DIR/backend/.env"
set_env WEB_ORIGIN  "$WEB_ORIGIN" "$PANEL_DIR/backend/.env"
set_env TRUST_PROXY 1             "$PANEL_DIR/backend/.env"   # panel di belakang nginx

# ---------------------------------------------------------------- 4. Database
log "Menyiapkan MySQL (bind 127.0.0.1, db nodepanel)..."
MYSQL_SKIP="mysql --skip-password"
$MYSQL_SKIP -e "CREATE DATABASE IF NOT EXISTS nodepanel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
$MYSQL_SKIP <<'SQL'
CREATE USER IF NOT EXISTS 'nodepanel'@'127.0.0.1' IDENTIFIED BY 'PANEL_DB_PASS_PLACEHOLDER';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER ON nodepanel.* TO 'nodepanel'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
DB_PASS=$(grep '^DATABASE_URL=' "$PANEL_DIR/backend/.env" | sed -E 's|.*nodepanel:([^@]+)@.*|\1|')
$MYSQL_SKIP -e "ALTER USER 'nodepanel'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true

if grep -qE '^\s*#\s*bind-address' /etc/mysql/mysql.conf.d/mysqld.cnf 2>/dev/null; then
  sed -i 's|^\s*#\s*bind-address.*|bind-address = 127.0.0.1|' /etc/mysql/mysql.conf.d/mysqld.cnf
  systemctl restart mysql
fi

# ---------------------------------------------------------------- 5. Build & migrate
log "Instalasi dependensi & build..."
# Repo ini tidak menyertakan prisma/migrations, jadi `migrate deploy` tidak
# membuat tabel apa pun dan seed gagal (table `User` does not exist).
# Pakai mekanisme yang sesuai: migration bila ada, kalau tidak `db push`.
if [[ -d "$PANEL_DIR/backend/prisma/migrations" ]]; then
  DB_SETUP="npx prisma migrate deploy"
else
  log "Tidak ada prisma/migrations — menyinkronkan skema dengan prisma db push..."
  DB_SETUP="npx prisma db push"
fi
sudo -u "$PANEL_USER" bash -lc "cd $PANEL_DIR/backend  && npm install --no-audit --no-fund && $DB_SETUP && npm run seed"
sudo -u "$PANEL_USER" bash -lc "cd $PANEL_DIR/frontend && npm install --no-audit --no-fund && npm run build"

# ---------------------------------------------------------------- 6. Frontend (Nginx)
# Port 2087 tetap API saja (Fastify). Nginx menyajikan hasil build di port 80
# dan meneruskan /api + /socket.io ke backend, jadi frontend dan API
# berasal dari origin yang sama (CORS & cookie refresh langsung cocok).
log "Menulis vhost Nginx (serve frontend/dist + proxy → 127.0.0.1:${PANEL_PORT})..."
cat > /etc/nginx/sites-available/nodepanel <<NGINX_CONF
# NodePanel — frontend Vue (Vite build) + reverse proxy ke Fastify :${PANEL_PORT}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${PANEL_DIR}/frontend/dist;
    index index.html;

    client_max_body_size 100m;        # samakan dengan MAX_UPLOAD_MB

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # ---- Backend (API) ----
    location /api {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # ---- Socket.io (realtime dashboard) ----
    location /socket.io {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
    }

    # ---- Asset build (nama file ber-hash) boleh di-cache ----
    location /assets/ {
        try_files \$uri =404;
        expires 7d;
        add_header Cache-Control "public";
    }

    # ---- SPA fallback (vue-router history mode) ----
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX_CONF

# Halaman selamat datang bawaan Ubuntu memakai port 80 juga — nonaktifkan.
ln -sfn /etc/nginx/sites-available/nodepanel /etc/nginx/sites-enabled/nodepanel
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx || systemctl restart nginx

# ---------------------------------------------------------------- 7. Sudoers
log "Menulis sudoers terbatas..."
cat > /etc/sudoers.d/nodepanel <<'EOF'
# NodePanel — hanya perintah yang dibutuhkan panel
nodepanel ALL=(root) NOPASSWD: /usr/bin/nginx -t, /usr/bin/systemctl reload nginx, /usr/bin/systemctl restart nginx, /usr/bin/systemctl status *
EOF
chmod 440 /etc/sudoers.d/nodepanel
visudo -cf /etc/sudoers.d/nodepanel >/dev/null

# ---------------------------------------------------------------- 8. PM2
log "Menjalankan panel dengan PM2..."
sudo -u "$PANEL_USER" PM2_HOME="/home/$PANEL_USER/.pm2" pm2 delete nodepanel 2>/dev/null || true
sudo -u "$PANEL_USER" PM2_HOME="/home/$PANEL_USER/.pm2" \
  pm2 start "$PANEL_DIR/backend/app.js" --name nodepanel --cwd "$PANEL_DIR/backend"
sudo -u "$PANEL_USER" PM2_HOME="/home/$PANEL_USER/.pm2" pm2 save
sudo -u "$PANEL_USER" PM2_HOME="/home/$PANEL_USER/.pm2" pm2 startup systemd -u "$PANEL_USER" --hp "/home/$PANEL_USER" >/dev/null || true

# ---------------------------------------------------------------- 9. SSL self-signed
SSL_DIR="/etc/nodepanel/ssl"
if [[ ! -f "$SSL_DIR/fullchain.pem" ]]; then
  log "Membuat sertifikat self-signed untuk panel..."
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=nodepanel.local/O=NodePanel" 2>/dev/null
fi

# ---------------------------------------------------------------- 10. Firewall
log "Mengonfigurasi UFW (2087, 80, 443)..."
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp
ufw allow "${PANEL_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable >/dev/null

log "Selesai."
echo
echo "  Panel      : ${PANEL_URL}/                    (frontend Vue via Nginx, port 80)"
echo "  Health     : curl -s ${PANEL_URL}/api/health   (di-proxy ke 127.0.0.1:${PANEL_PORT})"
echo "  API langsung: curl -s http://127.0.0.1:${PANEL_PORT}/api/health"
echo "  Logs       : pm2 logs nodepanel"
echo "  Env        : $PANEL_DIR/backend/.env   (password admin ada di hasil seed)"
echo
echo "  Ingat: ganti password admin seed, pasang domain + Certbot untuk panel,"
echo "  dan aktifkan HTTPS (lihat docs/INSTALL.md bagian reverse proxy)."
