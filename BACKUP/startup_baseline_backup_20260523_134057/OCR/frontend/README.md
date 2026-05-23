# WARDS Frontend - React

Frontend application for the WARDS Queue Management System.

## Technology

- **React 18**: Modern UI library
- **Tailwind CSS**: Utility-first CSS framework
- **React Router**: Client-side routing
- **Axios**: HTTP client for API calls
- **Vite**: Fast build tool and dev server

## Structure

```
frontend/
├── package.json                # Dependencies and scripts
├── vite.config.js              # Vite configuration
├── tailwind.config.js          # Tailwind CSS configuration
├── postcss.config.js           # PostCSS configuration
├── index.html                  # HTML entry point
└── src/
    ├── main.jsx                # React entry point
    ├── App.jsx                 # Main application component
    ├── index.css               # Global styles with Tailwind
    ├── components/             # Reusable components
    │   └── Layout.jsx          # Main layout with header/footer
    ├── pages/                  # Page components
    │   ├── Home.jsx            # Home page with announcements
    │   ├── About.jsx           # About us page
    │   ├── Services.jsx        # Services listing
    │   ├── Queue.jsx           # Queue management
    │   ├── Contact.jsx         # Contact information
    │   └── Login.jsx           # Admin login (placeholder)
    └── services/               # API integration
        └── api.js              # Axios configuration and API calls
```

## Installation

```bash
npm install
```

## Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Building for Production

```bash
npm run build
```

The production-ready files will be in the `dist/` directory.

## Preview Production Build

```bash
npm run preview
```

## Design System

### Colors
- **Primary**: Blue tones (government professional)
- **Accent**: Green (trust and progress)
- **Neutral**: Gray scale for text and backgrounds

### Components
Custom Tailwind classes defined in `index.css`:
- `.btn-primary`: Primary action button
- `.btn-secondary`: Secondary action button
- `.card`: Card container with shadow
- `.input-field`: Form input styling

### Pages

1. **Home**: Announcements and quick actions
2. **About Us**: Mission, vision, and values
3. **Services**: Available services with descriptions
4. **Queue System**: Take numbers and check status
5. **Contact Us**: Office information and FAQs
6. **Login**: Admin authentication (placeholder)

## API Integration

The `api.js` file contains all API calls organized by resource:
- `announcementAPI`: Announcement operations
- `serviceAPI`: Service operations
- `queueAPI`: Queue operations

Base URL: `http://localhost:8000/api`

## Responsive Design

The application is fully responsive:
- Mobile-first approach
- Breakpoints: sm, md, lg, xl
- Flexbox and Grid layouts

## Browser Support

Modern browsers with ES6+ support:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
