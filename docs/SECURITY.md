# 🔒 SECURITY — Model Ancaman & Kontrol NodePanel

Dokumen ini menjelaskan kontrol keamanan yang **sudah diimplementasikan** di Fase 1,
lokasi kodenya, dan daftar yang masih jadi tanggung jawab operator.

---

## 1. Autentikasi & Sesi

| Kontrol | Detail | Kode |
| --- | --- | --- |
| Access token | JWT, expire **15 menit**, hanya di header `Authorization` (tidak pernah di storage browser) | `backend/src/services/auth.service.js` |
| Refresh token | Cookie `np_rt`, **30 hari**, `httpOnly` + `SameSite=Strict` + `Secure` (prod) + `path=/api/auth`, disimpan sebagai **SHA-256** di tabel `Session`, dirotasi tiap refresh | `auth.service.js` |
| Password hash | bcrypt **cost 12** (`bcryptjs`, tanpa native build) | `auth.service.js` |
| Rate limit login | **5 percobaan / 15 menit per IP** (`@fastify/rate-limit`) + global 300 req/menit | `src/routes/auth.routes.js` |
| Account lockout | **10 login gagal / 15 menit** per identifier → ditolak | `auth.service.js` + `audit.service.js` |
| Default admin | Seed `admin@localhost` wajib diganti; password default tidak pernah dipakai di produksi | `backend/prisma/seed.js` |
| Audit login | Semua login sukses/gagal dicatat: aksi, IP, user-agent | `writeAudit()` |

**Belum di Fase 1:** 2FA TOTP, forgot-password, force-logout semua sesi dari UI.

Frontend menyimpan access token hanya di memori (Pinia) — refresh token tidak pernah
diakses JS karena cookie `httpOnly`.

## 2. Otorisasi

`src/middleware/authorize.js` mengecek role per rute:

- `SUPER_ADMIN` — akses penuh
- `ADMIN` — semua fitur kecuali server config & terminal
- `OPERATOR` — domain, file, database

Contoh: kontrol service (`start/stop/restart`) dan semua aksi SSL hanya `ADMIN+`
(`preHandler: [app.authenticate, app.authorize('ADMIN')]`).

## 3. Eksekusi Perintah Sistem

Dua pilar, keduanya wajib:

1. **`spawn()` dengan array argumen** — tidak pernah `exec()`/string interpolation,
   sehingga karakter `;`, `|`, `` ` `` tidak pernah ditafsirkan shell.
2. **Whitelist binari** — hanya `nginx`, `systemctl`, `certbot`, `ufw`, `pm2` yang bisa
   dieksekusi; nama lain → error. `PATH` dibatasi.

Lokasi: `backend/src/utils/shell.js`.
Ditambah mode **`PANEL_DRY_RUN=1`** yang melewati seluruh eksekusi (development/CI).

```js
runWhitelisted('nginx', ['-t'])   // ✅
runWhitelisted('bash', ['-c', x]) // ❌ ditolak whitelist
```

## 4. File Manager (Chroot)

`backend/src/utils/pathGuard.js` + `file.service.js`:

- Semua path dinormalisasi lalu **resolved** (realpath, symlink diikuti) dan harus berada
  di dalam salah satu `PANEL_FILE_ROOTS` (default `/var/www,/home`) → `../`, symlink ke
  `/etc`, dan encoded traversal otomatis 403.
- Path root tidak bisa dihapus.
- Upload: whitelist ekstensi + batas `MAX_UPLOAD_MB` (default 100 MB) + `bodyLimit` 2 MB
  untuk payload JSON.
- Kode error `PathError` membawa status HTTP (400/403/413) sehingga pesan ke client jelas
  tanpa membocorkan detail internal.

**Operator wajib:** jangan menambahkan `/`, `/etc`, atau `/root` ke `PANEL_FILE_ROOTS`.

## 5. Input Validation

- Semua body/query rute divalidasi **Fastify JSON Schema (Ajv)** dengan
  `additionalProperties: false` — field asing ditolak (400).
- Nama domain divalidasi regex whitelist `[a-zA-Z0-9.-]` (`isValidDomain`).
- Nama file/folder hanya `[A-Za-z0-9._-]`.
- Query parameter bertipe `boolean`/`enum` dikonversi ketat oleh schema.

## 6. HTTP & Browser Security

Dikonfigurasi di `backend/app.js`:

- **helmet**: `Content-Security-Policy` ketat (`default-src 'self'`, `script-src 'self'`
  tanpa `unsafe-inline`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, HSTS hanya saat `NODE_ENV=production`.
- **CORS**: hanya `WEB_ORIGIN` dan `PANEL_URL`; origin lain → **403**
  (`cors_origin_denied`), cookie tidak akan terkirim lintas origin.
- **Socket.io**: handshake wajib `auth.token` JWT valid; token kadaluarsa → disconnect.
- Error **500 tidak pernah** mengirim detail internal (query DB/stack) ke client — hanya
  log server.

## 7. Database

- Prisma **parameterized query** — tidak ada string SQL yang di-interpolasi.
- Kredensial hanya di `.env` (di-gitignore) atau environment variable PM2.
- User MySQL panel: `SELECT,INSERT,UPDATE,DELETE,CREATE,DROP,ALTER` saja, terikat
  `127.0.0.1`, dan **tidak** punya hak `GRANT`/`FILE`/`SUPER`.
- `bind-address = 127.0.0.1` — MySQL tidak boleh terekspos ke publik.

## 8. Server Hardening (operator)

Checklist yang **tidak** bisa diotomatisasi panel:

- [ ] Panel berjalan dengan user `nodepanel` (bukan root), port non-standar **2087**
- [ ] HTTPS wajib untuk panel (self-signed minimal, Let's Encrypt bila ada domain)
- [ ] UFW: `default deny incoming`, hanya 2087/80/443/SSH
- [ ] Fail2ban untuk SSH dan port panel
- [ ] SSH: port non-standar, `PermitRootLogin no`, `PasswordAuthentication no`
- [ ] `mysql` bind 127.0.0.1, password kuat, backup terjadwal & terenkripsi
- [ ] Ganti password seed + simpan secret di secret manager, bukan di git

## 9. Audit Trail

Setiap aksi penting dicatat ke `AuditLog` (siapa, apa, resource, IP, status, timestamp):
login, create/update/delete domain, tulis/hapus file, terbitkan/renew SSL, kontrol service.
Log ditulis lewat `writeAudit()` yang gagal-aman (tidak menggagalkan request utama).

## 10. Batasan Fase 1

- Belum ada: 2FA TOTP, scan ClamAV untuk upload, IP whitelist login, rotasi secret otomatis.
- Riwayat bandwidth masih in-memory (24 jam) — bukan masalah keamanan, tapi tidak bertahan
  setelah restart.
- Web terminal (Fase 2) harus tetap memakai whitelist + audit perintah sesuai bagian 4 & 9.

Laporkan kerentanan secara privat ke maintainer; jangan buka issue publik berisi PoC.
