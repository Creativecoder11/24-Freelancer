# 24 Freelancing — Local & Demo Credentials

This document contains the local development and testing accounts for the **Admin Panel**, **Workers**, and **Employers**, along with seed/reset commands.

---

## 👑 1. Admin Panel Credentials

* **Admin Portal URL**: `http://localhost:3001` (or `/admin/login`)
* **Default Password (all admins)**: `Admin123!`
* **TOTP / 2FA**: Disabled for local development (`ADMIN_TOTP_REQUIRED=false`).

| Role | Email | Name | Default Password |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@24freelancing.local` | Imran Hossain | `Admin123!` |
| **Super Admin (2nd)** | `super2@24freelancing.local` | Rafiq Chowdhury | `Admin123!` |
| **Operations Admin** | `ops@24freelancing.local` | Mitu Akter | `Admin123!` |
| **Finance Admin** | `finance@24freelancing.local`<br>*(also: `finance@24freelancing.com`)* | Farhana Akter | `Admin123!` |
| **Moderator** | `moderator@24freelancing.local`<br>*(also: `moderation@24freelancing.com`)* | Sabbir Rahman | `Admin123!` |
| **Support Agent** | `support@24freelancing.local` | Nadia Islam | `Admin123!` |
| **Analyst** | `analyst@24freelancing.local` | Tariq Ahmed | `Admin123!` |

> **To re-seed or reset admin accounts:**
> ```bash
> cd 24freelancing/apps/api && pnpm run script src/modules/admin/scripts/seed-admins.ts
> ```

---

## 👷 2. Worker Credentials (Freelancer Accounts)

* **Web Portal URL**: `http://localhost:3005/login`
* **Default Password**: `Password1!`

### Primary Worker (Figma Sample Persona)
* **Name**: Nusrat Jahan
* **Email**: `nusrat.j@example.com`
* **Phone**: `+8801712345569`
* **Public ID**: `482910`
* **Password**: `Password1!`
* **Status**: KYC Verified, 2FA enabled, Referral code: `NUSRAT24`

### Additional Workers
| Name | Email | Public ID | Status / Role | Password |
| :--- | :--- | :--- | :--- | :--- |
| **Rahima Akter** | `rahima.a@example.com` | `731546` | Active Worker (Referral: `RAHIMA51`) | `Password1!` |
| **Joya Saha** | `joya.s@example.com` | `905233` | Active Worker | `Password1!` |
| **Samir Khan** | `samir.k@example.com` | `318844` | Restricted Worker (for testing restrictions) | `Password1!` |

---

## 🏢 3. Employer Credentials (Job Posters)

* **Web Portal URL**: `http://localhost:3005/login`
* **Default Password**: `Password1!`

| Business / Employer Name | Email | Public ID | Password |
| :--- | :--- | :--- | :--- |
| **Shelfwise Ltd.** | `accounts@shelfwise.example` | `120774` | `Password1!` |
| **Orbit Research** | `team@orbitresearch.example` | `120801` | `Password1!` |
| **Kasem Mia** | `kasem.m@example.com` | `644018` | `Password1!` |
| **Lumen Apps** | `lumenapps@example.com` | `120802` | `Password1!` |
| **Pocketly** | `pocketly@example.com` | `120803` | `Password1!` |
| **Pixelorb Studio** | `pixelorbstudio@example.com` | `120805` | `Password1!` |

---

## 🔧 4. Password Reset & Database Utilities

If passwords get desynchronized or locked during testing, run these commands:

1. **Reset all demo users' passwords to `Password1!` and clear lockouts:**
   ```bash
   cd 24freelancing
   pnpm --filter @24f/api demo:passwords
   ```

2. **Re-seed Admin Accounts (sets password to `Admin123!`):**
   ```bash
   cd 24freelancing/apps/api
   pnpm run script src/modules/admin/scripts/seed-admins.ts
   ```

3. **Database connection string (Local Dev):**
   ```text
   postgresql://nurmohammadkawser@localhost:5432/fl_dev
   ```

