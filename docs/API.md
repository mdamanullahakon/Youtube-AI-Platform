# API Reference

## Authentication

### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "User Name"
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

### Get Profile
```http
GET /api/auth/profile
Authorization: Bearer <token>
```

## Trends

### Analyze Trends
```http
POST /api/trends/analyze
Authorization: Bearer <token>
```

### Get Trend History
```http
GET /api/trends/history
Authorization: Bearer <token>
```

## Scripts

### Generate Script
```http
POST /api/scripts/generate/:projectId
Authorization: Bearer <token>
```

## Videos

### Generate Full Pipeline
```http
POST /api/videos/generate/:projectId
Authorization: Bearer <token>
```

### Render Video
```http
POST /api/videos/render/:projectId
Authorization: Bearer <token>
```

### Get Project Status
```http
GET /api/videos/status/:projectId
Authorization: Bearer <token>
```

## Upload

### Upload to YouTube
```http
POST /api/upload/youtube/:projectId
Authorization: Bearer <token>
```

### Upload History
```http
GET /api/upload/history
Authorization: Bearer <token>
```

## Analytics

### Dashboard Stats
```http
GET /api/analytics/dashboard
Authorization: Bearer <token>
```

### Recent Projects
```http
GET /api/analytics/projects
Authorization: Bearer <token>
```

### Project Analytics
```http
GET /api/analytics/project/:projectId
Authorization: Bearer <token>
```
