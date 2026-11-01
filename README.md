# Horanov Store v0.4 — Cloudflare + GitHub Releases

**What's new:** new Worker (`horanov-store-v04`), new empty D1 (`horanov-store-v04-db`), custom domain `store.horanov.com`, online-only Expo app, direct in-app APK downloads, SHA-256 verification, no R2 and no seeded/demo apps.

## I. Deploy a separate Worker on Windows 10

1. **Keep your old v0.3 Worker and database until v0.4 works.** This archive deploys NEW resources. Do not delete anything in Cloudflare first.
2. Make sure `horanov.com` is an active zone under the Cloudflare account used by Wrangler. `store.horanov.com` must not have a conflicting DNS CNAME/Worker binding. Main `horanov.com` is untouched.
3. Open a PowerShell terminal in the archive's root directory, run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\cloudflare\deploy-windows.ps1
   ```

   The script installs dependencies, checks Wrangler authentication, creates `horanov-store-v04-db`, writes its UUID to `cloudflare/wrangler.jsonc`, applies the migration, deploys `horanov-store-v04` on `store.horanov.com`, and prompts to generate an `ADMIN_TOKEN` secret. Copy the token to a password manager; **never commit or send it**.

4. Check:
   - https://store.horanov.com/api/health
   - https://store.horanov.com/api/apps (expect `{"apps":[]}`)
   - https://store.horanov.com/admin
   - https://store.horanov.com/ (public website)

If deployment fails on `store.horanov.com`, verify your Cloudflare zone and its DNS settings; Custom Domains cannot be attached to a hostname with a conflicting CNAME. The Worker will not appear on that domain until the deployment completes.

### Manual deployment (alternative)

```powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create horanov-store-v04-db
```

Insert the newly created **database_id** UUID into `cloudflare/wrangler.jsonc` then:

```powershell
npm run db:remote
npm run deploy
npx wrangler secret put ADMIN_TOKEN
```

## II. Store an APK without R2

Use **public GitHub Releases** (NOT a source-code ZIP and NOT a private repository).

1. Build a **signed release APK** using EAS Build (or your preferred build pipeline), with a stable `applicationId` and signing key.
2. On GitHub, make a public repository, select **Releases → Draft a new release**, create a tag such as `v1.0.0`, and attach the actual `.apk` file as a release asset. Publish the release.
3. Copy the asset's full URL. It should look like:
   `https://github.com/OWNER/REPO/releases/download/v1.0.0/horanov-notes.apk`
4. Compute the SHA-256 checksum locally, using the exact file uploaded to GitHub:

   ```powershell
   (Get-FileHash 'D:\path\to\horanov-notes.apk' -Algorithm SHA256).Hash.ToLower()
   ```

5. Open https://store.horanov.com/admin, enter `ADMIN_TOKEN`, and publish app metadata: ID, name, version, description, GitHub Release URL, SHA-256. The app appears in the mobile catalog after refresh. The form rejects links other than public GitHub Releases `.apk` URLs.

GitHub release assets are convenient for initial distribution. Monitor GitHub usage and terms as you scale; use dedicated object storage/CDN if needed later. Keep signing keys private; verify APKs before publication.

## III. Start Expo Go 58.0.5 locally

From project root:

```powershell
npm install
npx expo install --check
npx expo start -c
```

Scan the QR in Expo Go. The API URL is **hardcoded** in `src/config.ts` as `https://store.horanov.com`. If this hostname hasn't been deployed, the app will display a connection error, not fake demo listings.

- The APK download button downloads inside the app using `expo-file-system` (`File.createDownloadTask()`), with progress and SHA-256 verification (`File.digest('SHA-256')`).
- Downloads live in the app's own documents directory. On the **Файли** tab, `Поділитися файлом` opens the Android share sheet. This does **not guarantee installation**.
- Expo Go cannot implement a reliable native APK installer. A later **standalone development/production build with native Android PackageInstaller integration** is required for an in-app install/update experience. Android can still request user approval; silent installation is conditional.
- Updates in v0.4 are changes to catalog versions, not verified installed Android package versions.

## IV. What's in the archive

```
App.tsx                       expo mobile UI (online-only)
src/catalog.ts                StoreApp types (no test data)
src/config.ts                 fixed https://store.horanov.com
src/remote.ts                 catalog client
src/components/BootScreen.tsx animated loader
cloudflare/src/index.ts       Hono API, D1 admin endpoints
cloudflare/src/page.ts        public website + administrator UI
cloudflare/migrations/        empty initial schema
cloudflare/wrangler.jsonc     new Worker + custom domain
cloudflare/deploy-windows.ps1 Windows bootstrap
```

## V. Troubleshooting

- npm ERESOLVE: v0.4 uses `@cloudflare/workers-types` v5 to match Wrangler 4.156. Do not use `--legacy-peer-deps` to hide incompatibilities.
- Old Worker still exists: that's intentional. Remove it **only after** the new service works.
- `store.horanov.com` shows SSL/DNS error: confirm correct Cloudflare account/zone and no existing conflicting CNAME.
- In-app download fails: confirm a **public GitHub release asset**, a valid HTTPS URL, and that the SHA-256 corresponds to the asset.
- GitHub release 404: repository or release must be public; tag and asset filename must match exactly.
- Android cannot install after sharing: expected on Expo Go; native installer requires a new build.
