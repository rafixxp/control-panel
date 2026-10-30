# 🌐 API — NodePanel

Base URL: `http(s)://<panel>:2087` — semua endpoint berada di bawah `/api`.

- **Auth:** header `Authorization: Bearer <access token>` (JWT 15 menit)
- **Refresh & login:** cookie `np_rt` (`httpOnly`, `SameSite=Strict`) via `withCredentials`
- **Format:** JSON · waktu dalam ISO 8601 · ID domain/SSL bertipe integer
- **Validasi:** JSON Schema (Ajv), `additionalProperties: false` → field asing = 400

### Respons error

```json
{ "error": "invalid_credentials", "message": "Email atau password salah." }
```

| Status | Arti |
| --- | --- |
| 400 | validasi schema / input tidak valid |
| 401 | token hilang/kedaluwarsa (`token_expired`) / kredensial salah |
| 403 | role kurang, CORS origin ditolak (`cors_origin_denied`), path di luar chroot |
| 404 | resource tidak ada |
| 409 | konfeksi (domain sudah terdaftar) |
| 429 | rate limit (login 5/15 menit) |
| 500 | error internal — pesan selalu generik, detail ada di log server |

---

## Health

| Method | Path | Auth | Keterangan |
| --- | --- | --- | --- |
| GET | `/api/health` | – | `{ status, service, version, uptime, dryRun, at }` — untuk monitoring eksternal |

---

## Auth — `/api/auth`

| Method | Path | Auth | Body / Keterangan |
| --- | --- | --- | --- |
| POST | `/login` | – | `{ identifier, password, rememberMe? }` → `{ accessToken, user, expiresIn }` + set cookie refresh. **Rate limit 5/15 menit per IP.** |
| POST | `/refresh` | cookie | Rotasi refresh token → `{ accessToken, user, expiresIn }` (60 req/menit) |
| POST | `/logout` | cookie | Cabut sesi & clear cookie → `{ ok: true }` |
| GET | `/me` | ✔ | `{ user: { id, name, email, role, lastLogin, ... } }` |
| GET | `/sessions` | ✔ | Daftar sesi milik user (IP, UA, dibuat, kedaluwarsa) |

`user.role` ∈ `SUPER_ADMIN` · `ADMIN` · `OPERATOR`.

## Dashboard — `/api/dashboard`

| Method | Path | Auth | Keterangan |
| --- | --- | --- | --- |
| GET | `/summary` | ✔ | `{ stats, services, activity, domains, databases, expiringSsl, users }` |
| GET | `/stats` | ✔ | `{ stats, services }` saja |
| GET | `/bandwidth?hours=6` | ✔ | `{ hours, points: [{ at, inKbps, outKbps }], note }` — `hours` 1–24, sampler in-memory tiap 5 detik |
| POST | `/services/:key/:action` | ADMIN | `action` ∈ `start` · `stop` · `restart` · `reload`; `key` harus unit whitelist. Mode dry-run → `{ status: "dry-run" }` |

Bentuk `stats`:

```json
{
  "cpu": { "percent": 12.4, "cores": 4, "model": "..." },
  "ram": { "totalGb": 7.8, "usedGb": 3.1, "percent": 39.7 },
  "disk": [{ "mount": "/", "sizeGb": 40, "usedGb": 12.5, "usePercent": 31 }],
  "network": { "inKbps": 120, "outKbps": 340 },
  "load": [0.42, 0.38, 0.31],
  "uptime": "14d 3h 22m",
  "at": 1730000000000
}
```

## Domains — `/api/domains`

| Method | Path | Auth | Body / Query |
| --- | --- | --- | --- |
| GET | `/` | ✔ | `{ domains: [...] }` — termasuk `ssl` & jumlah subdomain |
| GET | `/:id` | ✔ | `{ domain }` |
| POST | `/` | ✔ | `{ name, phpVersion?, documentRoot?, enableHttps?, redirectHttps?, gzip?, customDirectives? }` → 201 `{ domain, vhost }`. Membuat direktori, render vHost, `nginx -t`, reload; `enableHttps` → job Certbot |
| PATCH | `/:id` | ✔ | `{ phpVersion?, gzip?, redirectHttps?, customDirectives?, isSuspended? }` |
| GET | `/:id/vhost` | ✔ | `{ vhost }` — isi file konfigurasi Nginx |
| DELETE | `/:id?removeFiles=true` | ✔ | Hapus vHost (+ direktori opsional) & record |

`phpVersion` ∈ `7.4` · `8.1` · `8.2` · `8.3`.
Domain `name` wajib lolos validasi `[a-zA-Z0-9.-]` dan unik (409 bila sudah ada).

## SSL — `/api/ssl`

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| GET | `/` | ✔ | `{ certificates: [{ id, domain, issuer, status, expiresAt, daysLeft, autoRenew, warning, critical }] }` |
| POST | `/issue` | ADMIN | `{ domainId }` → jalankan Certbot (lewat antrean Bull bila `REDIS_URL` ada) |
| POST | `/:id/renew` | ADMIN | Perpanjang sertifikat |
| POST | `/:id/revoke` | ADMIN | Cabut + hapus record |
| PATCH | `/:id` | ✔ | `{ autoRenew: boolean }` |
| POST | `/manual` | ADMIN | `{ domainId, certificate, privateKey }` (PEM, maks 20 KB) |

`status` ∈ `active` · `pending` · `expired`. `warning` = ≤30 hari, `critical` = ≤14 hari.

## Files — `/api/files`

Semua path **harus** berada di dalam `PANEL_FILE_ROOTS` (chroot) — di luar itu → 403.

| Method | Path | Auth | Parameter |
| --- | --- | --- | --- |
| GET | `/roots` | ✔ | `{ roots: string[], maxUploadMb }` |
| GET | `/list` | ✔ | `path`, `showHidden?` → `{ path, parent, items: [{ name, path, type, size, modifiedAt, hidden, readOnly }] }` |
| GET | `/read` | ✔ | `path` → `{ path, size, modifiedAt, content, editable }` (maks 2 MB) |
| PUT | `/write` | ✔ | `{ path, content }` (maks 2 MB) |
| GET | `/download` | ✔ | `path` → `application/octet-stream` |
| POST | `/mkdir` | ✔ | `{ path, name }` |
| POST | `/rename` | ✔ | `{ path, name }` |
| DELETE | `/` | ✔ | `path` — root tidak boleh dihapus (403) |
| POST | `/upload?path=` | ✔ | `multipart/form-data`, field `files` (multi). Whitelist ekstensi + `MAX_UPLOAD_MB` → `{ uploaded, errors, ok }` |
| GET | `/search` | ✔ | `path`, `q`, `recursive?` → `{ results }` |

`type` ∈ `dir` · `file` · `link`.

---

## WebSocket (Socket.io)

- **Path:** `/socket.io` (di-proxy oleh Vite saat development)
- **Handshake:** `io({ auth: { token: <access token> } })` — tanpa token → `unauthorized`
- **Event keluar:** `system:stats` setiap **2 detik** (bila ada klien terhubung)

```json
{
  "cpu": { "percent": 12.4, "cores": 4, "model": "..." },
  "ram": { "totalGb": 7.8, "usedGb": 3.1, "percent": 39.7 },
  "disk": [{ "mount": "/", "sizeGb": 40, "usedGb": 12.5, "usePercent": 31 }],
  "network": { "inKbps": 120, "outKbps": 340 },
  "load": [0.42, 0.38, 0.31],
  "uptime": "14d 3h 22m",
  "services": [{ "key": "nginx", "label": "Nginx", "unit": "nginx.service", "status": "running" }],
  "at": 1730000000000
}
```

Klien menyimpan access token di memori (bukan `localStorage`); saat 401, interceptor
Axios melakukan refresh sekali (single-flight) lalu mencoba ulang request.

---

## Contoh

```bash
# Login
curl -c jar -X POST http://localhost:2087/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@localhost","password":"***","rememberMe":true}'

# Pakai access token
TOKEN=$(curl -s -b jar -X POST http://localhost:2087/api/auth/refresh \
  -H 'Content-Type: application/json' | jq -r .accessToken)

curl -H "Authorization: Bearer $TOKEN" http://localhost:2087/api/dashboard/summary | jq .

# Buat domain
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:2087/api/domains \
  -d '{"name":"example.com","phpVersion":"8.3","enableHttps":true}'
```
