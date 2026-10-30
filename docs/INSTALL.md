# 📦 INSTALL — NodePanel di VPS Ubuntu (22.04 / 24.04)

Panduan instalasi produksi. Untuk development lokal, lihat [README](../README.md).

> ⚠️ Installer menjalankan perintah sistem (`apt`, `nginx`, `certbot`, `ufw`, `systemctl`).
> Jalankan di server yang memang ingin dikelola, bukan di mesin development.

## 1. Prasyarat

- VPS Linux (Ubuntu 22.04/24.04) dengan akses `root`/sudo
- DNS A record untuk domain panel (mis. `panel.example.com`) menunjuk ke IP server
- Node.js 20.11+ (LTS)

## 2. Instalasi otomatis

```bash
git clone https://github.com/yourrepo/nodepanel.git /opt/nodepanel
cd /opt/nodepanel
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

Installer akan:

1. Install Node.js LTS (bila belum ada), MySQL 8, Nginx, Redis, Certbot, PM2
2. Membuat user khusus `nodepanel` (bukan root)
3. Menyalin `.env.example` → `.env` dan **mengisi secret acak** (JWT, kunci kripto)
4. `npm install` backend & frontend, `vite build`
5. `prisma migrate deploy` + seed akun admin
6. Membuat sudoers entry terbatas (hanya `nginx`, `systemctl`, `certbot`)
7. Setup PM2 (`nodepanel`) + startup, generate self-signed SSL untuk panel
8. Membuka UFW: port **2087** (panel), **80**, **443**; SSH port kustom

Setelah selesai, login di `https://panel.example.com:2087` dengan akun hasil seed
dan **segera ganti password**.

## 3. Instalasi manual

```bash
# --- A. Dependensi sistem
sudo apt update && sudo apt install -y nginx mysql-server redis-server certbot python3-certbot-nginx ufw

# --- B. User khusus (panel jangan pernah jalan sebagai root)
sudo useradd -m -s /bin/bash nodepanel

# --- C. Kode
sudo chown -R nodepanel:nodepanel /opt/nodepanel && cd /opt/nodepanel

# --- D. Database MySQL
sudo mysql -e "CREATE DATABASE nodepanel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'nodepanel'@'127.0.0.1' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';"
sudo mysql -e "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,DROP,ALTER ON nodepanel.* TO 'nodepanel'@'127.0.0.1';"
sudo mysql -e "FLUSH PRIVILEGES;"     # pastikan bind-address = 127.0.0.1

# --- E. Backend
cd backend && cp .env.example .env && $EDITOR .env
npm install
npx prisma migrate deploy
npm run seed

# --- F. Frontend
cd ../frontend && npm install && npm run build    # hasil → frontend/dist

# --- G. Jalankan
cd .. && sudo -u nodepanel PM2_HOME=/home/nodepanel/.pm2 npx pm2 start backend/app.js --name nodepanel
sudo -u nodepanel npx pm2 save && sudo -u nodepanel npx pm2 startup systemd
```

## 4. Variabel environment wajib

Salin `backend/.env.example` lalu isi:

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | `mysql://user:pass@127.0.0.1:3306/nodepanel` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (pisahkan keduanya) |
| `PANEL_CRYPTO_KEY` | `openssl rand -hex 32` — enkripsi credential tersimpan |
| `PANEL_URL` | `https://panel.example.com:2087` (origin panel) |
| `WEB_ORIGIN` | origin frontend bila dihosting terpisah |
| `PANEL_FILE_ROOTS` | chroot file manager, default `/var/www,/home` |
| `CERTBOT_EMAIL` | email notifikasi Let's Encrypt |
| `NGINX_AVAILABLE_DIR` / `NGINX_ENABLED_DIR` | default `/etc/nginx/sites-{available,enabled}` |
| `REDIS_URL` | opsional — mengaktifkan antrian Bull untuk SSL |
| `TRUST_PROXY` | `1` hanya bila panel di belakang reverse proxy |
| `PANEL_DRY_RUN` | `1` untuk development/CI (perintah sistem tidak dijalankan) |

`NODE_ENV=production` mewajibkan semua secret terisi — proses langsung gagal start bila kosong.

## 5. Reverse proxy (opsional)

Agar panel bisa diakses lewat 443 tanpa port eksplisit:

```nginx
server {
  listen 443 ssl http2;
  server_name panel.example.com;

  ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

  client_max_body_size 100m;          # samakan dengan MAX_UPLOAD_MB

  location / {
    proxy_pass http://127.0.0.1:2087;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # diperlukan untuk Socket.io (realtime dashboard)
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 90s;
  }
}
```

Set `TRUST_PROXY=1` dan `PANEL_URL=https://panel.example.com` di `.env`, lalu restart PM2.
Tanpa `TRUST_PROXY=1`, rate limit login akan menghitung semua request dari IP proxy yang sama.

## 6. Konfigurasi sudoers

Panel **tidak** menjalankan `sudo` di kode — semua perintah dilewatkan `spawn()` dengan
whitelist (lihat [SECURITY.md](SECURITY.md)). Bila user `nodepanel` membutuhkan hak akses
tertentu, batasi eksplisit:

```
# /etc/sudoers.d/nodepanel
nodepanel ALL=(root) NOPASSWD: /usr/bin/nginx -t, /usr/bin/systemctl reload nginx, /usr/bin/systemctl restart nginx*
```

## 7. Verifikasi

```bash
curl -s http://127.0.0.1:2087/api/health        # {"status":"ok",...}
npx pm2 logs nodepanel
```

- Buka panel → login → dashboard harus menampilkan statistik realtime (dot "Realtime terhubung")
- Buat domain uji → cek file muncul di `/etc/nginx/sites-enabled/` dan `nginx -t` lolos
- Buat domain dengan "Enable HTTPS" → sertifikat muncul di menu SSL

## 8. Update

```bash
sudo ./scripts/update.sh     # git pull → build → prisma migrate deploy → pm2 restart
```

## 9. Troubleshooting

| Gejala | Penyebab / solusi |
| --- | --- |
| Login 500 | `DATABASE_URL` salah atau MySQL tidak jalan — cek `pm2 logs` |
| Dashboard "Realtime terputus" | proxy tidak meneruskan WebSocket — lihat blok `location /` di atas |
| Upload gagal | `client_max_body_size` nginx < `MAX_UPLOAD_MB`, atau ekstensi tidak di whitelist |
| Perintah nginx "dilewati" | `PANEL_DRY_RUN=1` masih ter-set di environment |
| Domain dibuat tapi 500 | `nginx -t` gagal — baca log, template vHost ada di `backend/src/templates/nginx-vhost.conf` |
