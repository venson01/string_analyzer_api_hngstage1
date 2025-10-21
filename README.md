# 🧠 String Analyzer API

A RESTful API built with **Node.js + Express + SQLite** that analyzes strings, computes their properties, and stores them for later retrieval and filtering.

---

## 🚀 Features

- Analyze and store strings with computed properties:
  - Length
  - Word count
  - Unique characters
  - Palindrome check (case-insensitive)
  - Character frequency map
  - SHA-256 hash for unique identification
- Retrieve analyzed strings by value or by SHA-256 hash.
- Filter strings by query parameters or natural language.
- Delete stored strings.

---

## 🧩 Tech Stack

- **Node.js** — Runtime environment
- **Express** — Web framework
- **SQLite** (via `better-sqlite3`) — Lightweight local database
- **Helmet** — Basic security headers

---

## 🧰 Dependencies

These packages are required and automatically installed when you run `npm install`:

| Package | Purpose |
|----------|----------|
| `express` | API framework |
| `better-sqlite3` | Embedded SQLite database |
| `helmet` | Security headers |

---

## ⚙️ Setup Instructions (Local Development)

### 1️⃣ Clone the repository
```bash
git clone https://github.com/venson01/string_analyzer_api_hngstage1.git
cd string_analyzer_api_hngstage1
```

### 2️⃣ Install dependencies
```bash
npm install express better-sqlite3 helmet
```

### 3️⃣ Run the API
```bash
node index.js
```

By default, the server runs on:
```
http://localhost:8000/strings
```

---

## ⚙️ Environment Variables

The app can run with defaults, but you may override these environment variables:

| Variable | Default | Description |
|-----------|----------|-------------|
| `PORT` | `8000` | Port where the server runs |
| `DB_PATH` | `./strings.db` | SQLite database file path (optional) |

Example (Linux/macOS):
```bash
export PORT=8000
node index.js
```

Example (Windows PowerShell):
```powershell
set PORT=8000
node index.js
```

---

## 📚 API Endpoints Overview

### 1️⃣ Create / Analyze a String
**POST** `/strings`
```json
{
  "value": "hello world"
}
```

### 2️⃣ Get String by Value
**GET** `/strings/hello%20world`

### 3️⃣ Get String by ID
**GET** `/strings/by-id/:id`

### 4️⃣ List Strings with Filters
**GET** `/strings?is_palindrome=true&min_length=5`

### 5️⃣ Natural Language Filtering
**GET** `/strings/filter-by-natural-language?query=all%20single%20word%20palindromic%20strings`

### 6️⃣ Delete a String
**DELETE** `/strings/hello%20world`

---

## 🧪 Testing the API

Use **Postman**, **Insomnia**, or `curl`:
```bash
curl -X POST http://localhost:8000/strings \
  -H "Content-Type: application/json" \
  -d '{"value": "madam"}'
```

Expected output:
```json
{
  "id": "<sha256>",
  "value": "madam",
  "properties": {
    "length": 5,
    "is_palindrome": true,
    "unique_characters": 3,
    "word_count": 1,
    "sha256_hash": "...",
    "character_frequency_map": {"m":2,"a":2,"d":1}
  },
  "created_at": "2025-10-21T10:00:00Z"
}
```

---

## 🧹 Project Structure
```
string-analyzer-api-improved.js   # Main server file
package.json                      # Dependencies and scripts
strings.db                        # SQLite database file (auto-created)
README.md                         # This file
```

---

## 🧭 Notes
- Supports up to **10,000 characters per string**.
- Filtering is efficient via SQL queries.
- Case-insensitive matching for `contains_character`.
- Stores computed properties as JSON in the database.

---
