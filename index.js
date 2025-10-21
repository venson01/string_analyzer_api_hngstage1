
//String Analyzer API using Node.js + Express + better-sqlite3 
 

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const helmet = require('helmet');

const DB_PATH = './strings.db';
const PORT = process.env.PORT || 8000;
const MAX_STRING_LENGTH = 10000; // to restrict huge inputs

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// -----------------------------
// DB initialization
// -----------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS strings (
    id TEXT PRIMARY KEY,
    value TEXT UNIQUE NOT NULL,
    value_lower TEXT NOT NULL,
    length INTEGER NOT NULL,
    word_count INTEGER NOT NULL,
    is_palindrome INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    properties_json TEXT NOT NULL
  )
`).run();

// Indexes to speed up queries
db.prepare('CREATE INDEX IF NOT EXISTS idx_strings_value_lower ON strings(value_lower)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_strings_length ON strings(length)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_strings_word_count ON strings(word_count)').run();

// -----------------------------
// Utilities
// -----------------------------
function sha256Of(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function computeCharacterFrequency(s) {
  const freq = {};
  for (const ch of s) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  return freq;
}

function normalizeForPalindrome(s) {
  // Case-insensitive. Keep spaces/punct unless you want to strip them.
  return s.toLowerCase();
}

function isPalindrome(s) {
  const n = normalizeForPalindrome(s);
  return n === n.split('').reverse().join('');
}

function wordCount(s) {
  if (!s || s.trim() === '') return 0;
  const matches = s.match(/\S+/g);
  return matches ? matches.length : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function computeProperties(value) {
  const length = value.length;
  const pal = isPalindrome(value);
  const uniq = new Set(Array.from(value)).size;
  const wc = wordCount(value);
  const h = sha256Of(value);
  const freq = computeCharacterFrequency(value);
  return {
    length,
    is_palindrome: !!pal,
    unique_characters: uniq,
    word_count: wc,
    sha256_hash: h,
    character_frequency_map: freq,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    value: row.value,
    properties: JSON.parse(row.properties_json),
    created_at: row.created_at,
  };
}

// -----------------------------
// Routes
// -----------------------------

// Create / Analyze
app.post('/strings', (req, res) => {
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ detail: 'Invalid request body or missing "value" field' });
  if (typeof value !== 'string') return res.status(422).json({ detail: 'Invalid data type for "value" (must be string)' });
  if (value.length > MAX_STRING_LENGTH) return res.status(413).json({ detail: 'String too large' });

  const properties = computeProperties(value);
  const id = properties.sha256_hash;
  const created_at = nowIso();

  const insert = db.prepare(`
    INSERT INTO strings (id, value, value_lower, length, word_count, is_palindrome, created_at, properties_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    insert.run(
      id,
      value,
      value.toLowerCase(),
      properties.length,
      properties.word_count,
      properties.is_palindrome ? 1 : 0,
      created_at,
      JSON.stringify(properties)
    );
  } catch (err) {
    // Assume uniqueness conflict
    return res.status(409).json({ detail: 'String already exists in the system' });
  }

  return res.status(201).json({ id, value, properties, created_at });
});

// Get by value (exact match) - value must be URL encoded when necessary
app.get('/strings/:string_value', (req, res) => {
  const v = req.params.string_value;
  const row = db.prepare('SELECT * FROM strings WHERE value = ?').get(v);
  if (!row) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.json(rowToItem(row));
});

// Get by id (sha256)
app.get('/strings/by-id/:id', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM strings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.json(rowToItem(row));
});

// Delete - value must be URL encoded when necessary
app.delete('/strings/:string_value', (req, res) => {
  const v = req.params.string_value;
  const info = db.prepare('DELETE FROM strings WHERE value = ?').run(v);
  if (info.changes === 0) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.status(204).send();
});

// List with filtering (uses SQL WHERE clause where possible)
app.get('/strings', (req, res) => {
  const q = req.query;
  const clauses = [];
  const params = [];
  const filtersApplied = {};

  if (q.is_palindrome !== undefined) {
    if (q.is_palindrome === 'true') clauses.push('is_palindrome = 1');
    else if (q.is_palindrome === 'false') clauses.push('is_palindrome = 0');
    else return res.status(400).json({ detail: 'Invalid is_palindrome value' });
    filtersApplied.is_palindrome = q.is_palindrome === 'true';
  }

  if (q.min_length !== undefined) {
    const v = parseInt(q.min_length, 10);
    if (Number.isNaN(v) || v < 0) return res.status(400).json({ detail: 'Invalid min_length' });
    clauses.push('length >= ?'); params.push(v);
    filtersApplied.min_length = v;
  }

  if (q.max_length !== undefined) {
    const v = parseInt(q.max_length, 10);
    if (Number.isNaN(v) || v < 0) return res.status(400).json({ detail: 'Invalid max_length' });
    clauses.push('length <= ?'); params.push(v);
    filtersApplied.max_length = v;
  }

  if (q.word_count !== undefined) {
    const v = parseInt(q.word_count, 10);
    if (Number.isNaN(v) || v < 0) return res.status(400).json({ detail: 'Invalid word_count' });
    clauses.push('word_count = ?'); params.push(v);
    filtersApplied.word_count = v;
  }

  if (q.contains_character !== undefined) {
    const ch = q.contains_character;
    if (typeof ch !== 'string' || ch.length !== 1) return res.status(400).json({ detail: 'contains_character must be a single character' });
    // Case-insensitive search using value_lower
    clauses.push("instr(value_lower, ?) > 0"); params.push(ch.toLowerCase());
    filtersApplied.contains_character = ch;
  }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const sql = `SELECT * FROM strings ${where} ORDER BY created_at DESC LIMIT 100`;

  const rows = db.prepare(sql).all(...params);
  const items = rows.map(rowToItem);
  return res.json({ data: items, count: items.length, filters_applied: Object.keys(filtersApplied).length ? filtersApplied : undefined });
});

// Natural language filter - same heuristic parser but reuse SQL-based list when possible
function parseNlQuery(q) {
  const original = q;
  const lower = q.toLowerCase();
  const parsed = {};

  if (/\b(single|one) word\b/.test(lower)) parsed.word_count = 1;
  if (lower.includes('palindr') || lower.includes('palindrom') || lower.includes('palind')) parsed.is_palindrome = true;

  let m = lower.match(/longer than (\d+) (characters|chars)?/);
  if (m) parsed.min_length = Number(m[1]) + 1;
  else {
    let m2 = lower.match(/longer than (\d+)\b/);
    if (m2) parsed.min_length = Number(m2[1]) + 1;
  }

  let m3 = lower.match(/(?:contain(?:ing)?(?: the)?(?: letter)? )([a-z])\b/);
  if (m3) parsed.contains_character = m3[1];

  if (lower.includes('first vowel')) parsed.contains_character = 'a';

  if (Object.keys(parsed).length === 0) throw new Error('Unable to parse natural language query');

  return { original, parsed_filters: parsed };
}

app.get('/strings/filter-by-natural-language', (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ detail: 'query parameter is required' });

  let interp;
  try {
    interp = parseNlQuery(query);
  } catch (err) {
    return res.status(400).json({ detail: 'Unable to parse natural language query' });
  }

  // Map parsed filters to query params and delegate to /strings logic via internal call
  const parsed = interp.parsed_filters;
  const params = [];
  const clauses = [];

  if ('is_palindrome' in parsed) clauses.push('is_palindrome = 1');
  if ('min_length' in parsed) { clauses.push('length >= ?'); params.push(parsed.min_length); }
  if ('max_length' in parsed) { clauses.push('length <= ?'); params.push(parsed.max_length); }
  if ('word_count' in parsed) { clauses.push('word_count = ?'); params.push(parsed.word_count); }
  if ('contains_character' in parsed) { clauses.push('instr(value_lower, ?) > 0'); params.push(parsed.contains_character.toLowerCase()); }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const sql = `SELECT * FROM strings ${where} ORDER BY created_at DESC LIMIT 100`;
  const rows = db.prepare(sql).all(...params);
  const items = rows.map(rowToItem);

  return res.json({ data: items, count: items.length, interpreted_query: interp });
});

// -----------------------------
// Error handling
// -----------------------------
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ detail: 'Internal Server Error' });
});

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => console.log(`String Analyzer API listening on http://localhost:${PORT}`));
