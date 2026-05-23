# WARDS Backend - FastAPI

Backend API for the WARDS Queue Management System.

## Technology

- **FastAPI**: Modern, fast web framework for building APIs
- **Uvicorn**: ASGI server for running the application
- **Pydantic**: Data validation using Python type annotations

## Structure

```
backend/
├── main.py                     # Application entry point
├── requirements.txt            # Python dependencies
├── models/                     # Data models (Pydantic schemas)
│   ├── __init__.py
│   ├── announcement.py         # Announcement models
│   ├── service.py              # Service models
│   └── queue.py                # Queue models
├── routes/                     # API route handlers
│   ├── __init__.py
│   ├── announcements.py        # Announcement endpoints
│   ├── services.py             # Service endpoints
│   └── queue.py                # Queue endpoints
└── services/                   # Business logic
    ├── __init__.py
    ├── announcement_service.py # Announcement operations
    ├── service_service.py      # Service operations
    └── queue_service.py        # Queue operations
```

## Installation

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
```bash
# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the Server

```bash
python main.py
```

The API will be available at `http://localhost:8000`

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Data Storage

Currently uses in-memory storage. Data will be lost when the server restarts.

Future versions will integrate with a database (PostgreSQL/MySQL).

## CORS Configuration

CORS is enabled for:
- `http://localhost:3000` (Vite default)
- `http://localhost:5173` (Vite alternative)

Modify in `main.py` if needed.

## Development

The codebase follows a clean architecture pattern:
- **Models**: Define data structures
- **Routes**: Handle HTTP requests/responses
- **Services**: Contain business logic

This separation makes the code maintainable and testable.
