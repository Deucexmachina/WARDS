# WARDS CI/CD Deployment Notes

Recommended production path:

```text
GitHub Actions CI/CD -> Docker -> DigitalOcean -> Cloudflare WAF
```

## CI

`.github/workflows/wards-ci.yml` runs:

- Python dependency install
- Backend syntax checks
- SECURITY engine syntax checks
- Frontend `npm ci`
- Frontend production build

## Docker

Use:

```powershell
docker compose up --build
```

Main services:

- `mysql` on port 3306
- `backend` on port 8000
- `frontend` on port 3000

The backend mounts `WARDS`, `OCR`, `SECURITY`, and `QUARANTINE` so local backup and recovery can operate on real files.

## DigitalOcean

Options:

- Droplet with Docker Compose
- App Platform with managed MySQL
- Managed MySQL plus a small Docker host

Recommended environment variables:

```env
DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:3306/wards_db
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
WAZUH_ENABLED=true
FRONTEND_BASE_URL=https://your-domain.example
CORS_ORIGINS=https://your-domain.example
```

## Cloudflare

1. Add your domain to Cloudflare.
2. Point DNS to DigitalOcean.
3. Enable SSL/TLS Full mode.
4. Enable WAF managed rules.
5. Add rate limiting for `/api/auth/*` and `/api/security/*`.

Do not expose MySQL publicly. Restrict it to the app host or DigitalOcean private networking.
