# NodePanel 🖥️

Web hosting control panel modern berbasis **Node.js** — pengganti ringan untuk cPanel/Plesk,
dirancang untuk self-hosted VPS Linux. Antarmuka dark-first yang elegan, cepat, dan aman.

> Dokumen acuan: `hosting-panel-master-prompt.md`.
> **Status saat ini: Fase 1 (MVP) selesai** — Auth, Dashboard realtime, Domain manager,
> File manager dasar, dan SSL manager. Fase 2 & 3 (terminal, database manager, firewall, cron,
> backup, notifikasi) masih dalam backlog.

---

## ✨ Fitur Fase 1 (MVP)

| Modul | Isi |
| --- | --- |
| 🔐 **Auth** | Login (email/username), JWT access 15 menit, refresh token 30 hari (httpOnly cookie), bcrypt cost 12, rate limit 5 percobaan/15 menit/IP, account lockout 10 gagal/15 menit, rotasi refresh token, audit log login |
| 📊 **Dashboard** | Monitor realtime via Socket.io (CPU, RAM, disk per mount, network kbps, load, uptime), status service + aksi start/stop/restart (dry-run-aware), quick stats, activity log 10 terakhir, chart bandwidth |
| 🌐 **Domain Manager** | CRUD domain, template vHost Nginx, `nginx -t` sebelum reload, suspend/unsuspend, edit PHP 7.4–8.3, gzip, redirect HTTPS, direktif custom, preview vHost |
| 📁 **File Manager** | Jelajahi (chroot `PANEL_FILE_ROOTS`), upload multi-file, download, mkdir, rename, delete dengan konfirmasi, editor teks inline, pencarian rekursif, toggle hidden file |
| 🔒 **SSL Manager** | Terbitkan (Certbot), renew, revoke, unggah manual (PEM), toggle auto-renew, peringatan expiry ≤30 hari |

## 🛠️ Tech Stack

- **Backend:** Fastify 5 · Prisma 6 + MySQL 8 · Socket.io · Bull + Redis (opsional) · `systeminformation` · `@fastify/{helmet,cors,cookie,rate-limit,multipart}`
- **Frontend:** Vue 3 (Composition API) · Vite 6 · Tailwind CSS v4 · Pinia · Vue Router 4 · Axios · Chart.js + vue-chartjs · Lucide · Vue Toastification
- **Infrastruktur:** Nginx · Certbot · PHP-FPM 7.4/8.1/8.2/8.3 · PM2

## 📁 Struktur

```
nodepanel/
├── backend/                 # Fastify + Prisma (port 2087)
│   ├── app.js               # Entry point, helmet/CORS/rate-limit/socket
│   ├── prisma/              # schema.prisma + seed
│   └── src/
│       ├── config/          # env.js, database.js
│       ├── middleware/      # authenticate, authorize, auditLog
│       ├── plugins/         # socket.js (broadcast system:stats / 2 detik)
│       ├── routes/          # auth, dashboard, domain, ssl, files
│       ├── services/        # nginx, certbot, system, auth, file, audit
│       ├── queues/          # ssl.queue.js (Bull bila REDIS_URL ada)
│       ├── templates/       # nginx-vhost.conf
│       └── utils/           # shell.js (spawn whitelist), pathGuard.js, crypto.js
├── frontend/                # Vue 3 + Vite + Tailwind v4
│   └── src/
│       ├── components/      # ui/ · layout/ · widgets/
│       ├── pages/           # Login, Dashboard, Domains, DomainEdit, SSL, FileManager
│       ├── stores/          # auth, system, domain (Pinia)
│       ├── composables/     # useToast, useConfirm
│       ├── router/  api/
│       └── style.css        # design system (@theme Tailwind v4)
├── docs/                    # INSTALL.md · SECURITY.md · API.md
├── scripts/                 # install.sh · update.sh
└── docker-compose.yml       # MySQL 8.4 + Redis 7 untuk development
```

## 🚀 Quickstart (development)

```bash
# 1. Database & Redis (opsional) untuk development lokal
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # isi DATABASE_URL & secrets
npm install
npx prisma migrate dev        # atau: npx prisma db push
npm run seed
PANEL_DRY_RUN=1 npm run dev   # port 2087

# 3. Frontend (terminal lain)
cd frontend
npm install
npm run dev                   # port 5173, proxy /api & /socket.io → :2087
```

Login awal dari `backend/.env` seed: **`admin@localhost` / `ChangeMe-Immediately!`**
(ganti sebelum dipakai di produksi).

Tanpa MySQL, backend tetap bisa dinyalakan untuk melihat health check —
semua rute yang butuh database akan mengembalikan 500 generik. Untuk server produksi
ikuti [docs/INSTALL.md](docs/INSTALL.md).

### Mode dry-run

Set `PANEL_DRY_RUN=1` agar perintah sistem (`nginx`, `systemctl`, `certbot`, `ufw`) **tidak**
dijalankan — dipakai saat development, CI, dan lingkungan tanpa akses root.

## 🎨 Design system

Didefinisikan sekali di `frontend/src/style.css` memakai Tailwind v4 `@theme`
(palet, tipografi, radius sesuai dokumen):

| Token | Nilai | Token | Nilai |
| --- | --- | --- | --- |
| `bg-base` | `#0F1117` | `accent` | `#4F8EF7` |
| `bg-surface` | `#161B27` | `success` | `#34D399` |
| `bg-elevated` | `#1E2435` | `warning` | `#FBBF24` |
| `border` | `#2A3147` | `danger` | `#F87171` |
| `text-primary` | `#E8ECF4` | `text-muted` | `#8892A4` |

Radius: `rounded-card` 8px · `rounded-btn` 6px · `rounded-badge` 4px.
Font: **Inter** (UI) + **JetBrains Mono** (statistik/kode).
Tailwind v4 memakai konfigurasi CSS-first, jadi `tailwind.config.js` tidak diperlukan lagi.

## 📚 Dokumentasi

- [docs/INSTALL.md](docs/INSTALL.md) — instalasi di VPS Ubuntu, PM2, UFW, SSL panel
- [docs/SECURITY.md](docs/SECURITY.md) — model ancaman & kontrol keamanan
- [docs/API.md](docs/API.md) — referensi endpoint REST + WebSocket

## 🗺️ Roadmap

**Fase 2 (Power):** web terminal (xterm.js + node-pty), database manager, user management + role,
audit log UI.
**Fase 3 (Enterprise):** firewall manager, cron manager, backup, notifikasi eksternal,
multi-server via SSH. Bilingual UI (ID/EN) juga masih backlog.
