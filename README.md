# Ultimate Bookkeeping — Enhanced Mobile Edition

A real-time, cloud-based business management system built for small businesses in Ghana. Features inventory management, POS, sales tracking, AI-powered insights, multi-outlet support, and full offline capability.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Core App** | Vanilla JavaScript (ES6), HTML5, CSS3 |
| **React Shell** | React 19, shadcn/ui, Tailwind CSS |
| **Backend** | Python FastAPI |
| **Database** | Firebase Firestore (real-time, offline persistence) |
| **Auth** | Firebase Authentication (email/password, role-based) |
| **AI** | OpenAI GPT-5.2 via Emergent LLM |
| **Mobile** | PWA + Capacitor (Android & iOS) |
| **Hosting** | Firebase Hosting + Google Cloud Run |

## Features

- **Dashboard** — 8 KPI cards, interactive charts, AI-powered insights panel
- **Inventory** — Product management, barcode scanning, stock alerts, min-stock thresholds
- **POS** — Dedicated point-of-sale interface with cart, checkout, and receipt printing
- **Sales** — Single and bulk sales recording, discounts, tax, customer tracking
- **Expenses** — Categorized expense tracking with recurring expense automation
- **Multi-Outlet** — Branch management, consignments, settlements, commission tracking
- **Suppliers** — Supplier management, purchase orders, accounts payable
- **AI Assistant** — Business insights, sales forecasting, and Q&A chat (GPT-5.2)
- **Reports** — Financial reports, PDF/Excel export, invoice generation
- **Offline** — Full offline mode with IndexedDB queue and background sync
- **i18n** — English, Twi (Akan), and French

## Prerequisites

- **Node.js** >= 20.x (use `nvm use 20`)
- **Python** 3.11+ (for backend)
- **Firebase CLI** (`npm install -g firebase-tools`)
- **Android Studio** (for Android builds)
- **Xcode** (for iOS builds, macOS only)

## Getting Started

```bash
# Clone the repo
git clone <repo-url> && cd Ultimate-Bookkeeping-Enhanced-mobile-edition

# Install frontend dependencies
cd frontend && npm install && cd ..

# Set up backend
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..

# Create environment files
cp frontend/.env.example frontend/.env
# Edit frontend/.env and backend/.env with your keys
```

## Development

```bash
# Start the dev server (builds frontend + Express proxy)
npm run dev

# Start the backend API server
npm run backend

# Build frontend only
npm run build
```

## Mobile Development

```bash
# Build and sync to native projects
npm run mobile:build

# Open in Android Studio
npm run mobile:android

# Open in Xcode (run pod install first)
cd frontend/ios/App && pod install && cd ../../..
npm run mobile:ios

# Run on connected device
npm run mobile:run:android
npm run mobile:run:ios
```

## Deployment

```bash
# Deploy frontend to Firebase Hosting
npm run deploy

# Deploy backend to Google Cloud Run
npm run deploy:backend
```

## Project Structure

```
├── backend/                  # FastAPI backend (AI, email, scheduling)
│   ├── server.py             # Main API server
│   ├── email_service.py      # Gmail SMTP email
│   ├── scheduler.py          # APScheduler for reports
│   └── Dockerfile            # Cloud Run container
├── frontend/
│   ├── public/
│   │   ├── bookkeeping/      # Core bookkeeping SPA
│   │   │   ├── js/           # ES6 modules (controllers, services, utils)
│   │   │   ├── css/          # Stylesheets (responsive, dark theme, POS)
│   │   │   ├── locales/      # i18n translations (en, fr, tw)
│   │   │   └── sw.js         # Service worker
│   │   ├── assets/icons/     # PWA app icons
│   │   └── manifest.json     # PWA manifest
│   ├── src/                  # React shell (redirects to /bookkeeping/)
│   ├── capacitor.config.ts   # Capacitor native config
│   └── package.json
├── firebase.json             # Firebase hosting & Firestore config
├── firestore.rules           # Firestore security rules
└── memory/PRD.md             # Product requirements document
```

## Environment Variables

### Frontend (`frontend/.env`)
```
REACT_APP_BACKEND_URL=https://your-backend-url
```

### Backend (`backend/.env`)
```
OPENAI_API_KEY=your-key
GMAIL_USER=your-email
GMAIL_APP_PASSWORD=your-app-password
MONGODB_URI=your-mongodb-uri  # optional
```

## License

Private — All rights reserved.
