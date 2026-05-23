# WARDS Frontend

React-based frontend for the City Treasurer's Office WARDS system.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

The application will be available at http://localhost:3000

## Build for Production

```bash
npm run build
```

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Navbar.jsx
│   ├── Sidebar.jsx
│   ├── LoginModal.jsx
│   └── DashboardWidgets.jsx
│
├── pages/              # Page components
│   ├── public/         # Public-facing pages
│   │   ├── Home.jsx
│   │   ├── PayTaxes.jsx
│   │   └── RequestReceipt.jsx
│   │
│   └── admin/          # Admin dashboard pages
│       ├── Dashboard.jsx
│       ├── Branches.jsx
│       ├── Reports.jsx
│       ├── Announcements.jsx
│       ├── Memos.jsx
│       ├── Alerts.jsx
│       ├── ActivityLogs.jsx
│       ├── BackupRecovery.jsx
│       ├── Policies.jsx
│       ├── Settings.jsx
│       └── Accounts.jsx
│
├── layouts/            # Layout components
│   ├── PublicLayout.jsx
│   └── AdminLayout.jsx
│
├── services/           # API service layer
│   └── api.js
│
├── App.jsx             # Main app component with routing
└── main.jsx            # Entry point
```

## Features

### Public Portal
- Online tax payment with multiple payment methods
- Receipt requisition with payment requirement
- Responsive design for all devices

### Admin Dashboard
- Dashboard with real-time statistics
- Branch management (CRUD operations)
- Report generation and export
- Announcements management
- Internal memos
- System alerts monitoring
- Activity logs tracking
- Backup and recovery
- Policies and SOPs management
- System settings configuration
- Account management with RBAC

## Technologies

- React 18
- React Router DOM
- Tailwind CSS
- Axios
- Vite
