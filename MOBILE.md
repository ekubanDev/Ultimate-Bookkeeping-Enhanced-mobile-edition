## App icon

Source: `frontend/resources/app-icon.svg`. Regenerate all PNGs (PWA, Android mipmaps, iOS App Store icon):

```bash
npm run icons
# or: cd frontend && npm run icons
```

The script installs **sharp** into `frontend/.icon-gen-deps/` (ignored by git) so **Node 18 is fine**—no full `frontend` npm install required. If that fails, install **rsvg-convert** (`brew install librsvg`) and run again.

Then: `npm run build`, `npx cap sync` (from `frontend`).

## Mobile development guide

### Prerequisites

- **Node**: 20.x or newer
- **Global tooling**: Android Studio (SDK, emulator), Xcode + Command Line Tools, CocoaPods
- **Project install**:
  - From repo root: `npm install`
  - From `frontend`: `npm install`

### Running the app

- **Web (local)**: From repo root: `npm run dev` then open the logged `http://localhost:PORT`.
- **Backend (FastAPI)**: From repo root (with `backend/.env` configured): `npm run backend`.
- **Android (Capacitor)**:
  - From `frontend`: `npm run cap:run:android`
- **iOS (Capacitor)**:
  - From `frontend`: `npm run cap:run:ios`

### Backend configuration

- Web (Firebase Hosting) uses relative `/api/...` calls, which are rewritten to Cloud Run via `firebase.json`.
- Mobile (Capacitor) uses `window.BACKEND_URL` defined in `frontend/public/bookkeeping/index.html`:
  - Set `window.BACKEND_URL` to your Cloud Run HTTPS URL for production/staging.

### Environment notes

- Example frontend env file: `frontend/.env.example` (`REACT_APP_BACKEND_URL`).
- Firestore rules live in `firestore.rules`; update them if mobile introduces new collections.

