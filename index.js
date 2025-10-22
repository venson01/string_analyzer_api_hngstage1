
//String Analyzer API (Node.js + Express + better-sqlite3)
 
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const helmet = require('helmet');

const DB_PATH = process.env.DB_PATH || './strings.db';
const PORT = process.env.PORT || 8000;
const MAX_STRING_LENGTH = process.env.MAX_STRING_LENGTH ? parseInt(process.env.MAX_STRING_LENGTH, 10) : 10000;

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// -----------------------------
// DB init
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
  // compute SHA-256 using exact UTF-8 bytes
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
  // Case-insensitive per requirement: convert to lowercase only
  return s.toLowerCase();
}

function isPalindrome(s) {
  const n = normalizeForPalindrome(s);
  return n === n.split('').reverse().join('');
}

function wordCount(s) {
  // split on any unicode whitespace sequence; count tokens
  if (typeof s !== 'string') return 0;
  const trimmed = s.trim();
  if (trimmed === '') return 0;
  const matches = trimmed.match(/\S+/g);
  return matches ? matches.length : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function computeProperties(value) {
  const length = value.length;
  const pal = isPalindrome(value);
  const uniq = new Set(Array.from(value)).size; // case-sensitive unique characters (per spec)
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

// POST /strings - create/analyze
app.post('/strings', (req, res) => {
  const body = req.body;
  if (!body) {
    return res.status(400).json({ detail: 'Invalid request body or missing "value" field' });
  }
  if (typeof body !== 'string') {
    return res.status(422).json({ detail: 'Invalid data type for "value" (must be string)' });
  }
  const value = body.value;
  if (value.length > MAX_STRING_LENGTH) {
    return res.status(413).json({ detail: 'String too large' });
  }

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
    // Determine if it's a UNIQUE constraint violation vs other DB error
    // better-sqlite3 throws a generic Error; inspect message for 'UNIQUE' as a heuristic
    const msg = String(err && err.message).toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint')) {
      return res.status(409).json({ detail: 'String already exists in the system' });
    }
    /*console.error('DB insert error', err);
    return res.status(500).json({ detail: 'Internal Server Error' });*/
  }

  return res.status(201).json({ id, value, properties, created_at });
});

// GET /strings/:string_value
app.get('/strings/:string_value', (req, res) => {
  const v = req.params.string_value;
  const row = db.prepare('SELECT * FROM strings WHERE value = ?').get(v);
  if (!row) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.status(200).json(rowToItem(row));
});

// GET /strings/by-id/:id
app.get('/strings/by-id/:id', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM strings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.status(200).json(rowToItem(row));
});

// DELETE /strings/:string_value
app.delete('/strings/:string_value', (req, res) => {
  const v = req.params.string_value;
  const info = db.prepare('DELETE FROM strings WHERE value = ?').run(v);
  if (info.changes === 0) return res.status(404).json({ detail: 'String does not exist in the system' });
  return res.status(204).send();
});

// GET /strings (list + filters)
app.get('/strings', (req, res) => {
  const q = req.query || {};
  const clauses = {};
  const params = {};
  const filtersApplied = {};

  // is_palindrome
  if (q.is_palindrome !== undefined) {
    if (q.is_palindrome === 'true') clauses.push('is_palindrome = 1');
    else if (q.is_palindrome === 'false') clauses.push('is_palindrome = 0');
    else return res.status(400).json({ detail: 'Invalid value for is_palindrome (must be true or false)' });
    filtersApplied.is_palindrome = q.is_palindrome === 'true';
  }

  // min_length
  if (q.min_length !== undefined) {
    const v = Number(q.min_length);
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ detail: 'Invalid min_length' });
    clauses.push('length >= ?'); params.push(v);
    filtersApplied.min_length = v;
  }

  // max_length
  if (q.max_length !== undefined) {
    const v = Number(q.max_length);
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ detail: 'Invalid max_length' });
    clauses.push('length <= ?'); params.push(v);
    filtersApplied.max_length = v;
  }

  // if min > max -> 422
  if (filtersApplied.min_length !== undefined && filtersApplied.max_length !== undefined) {
    if (filtersApplied.min_length > filtersApplied.max_length) return res.status(422).json({ detail: 'min_length cannot be greater than max_length' });
  }

  // word_count
  if (q.word_count !== undefined) {
    const v = Number(q.word_count);
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ detail: 'Invalid word_count' });
    clauses.push('word_count = ?'); params.push(v);
    filtersApplied.word_count = v;
  }

  // contains_character (single char) - case-insensitive
  if (q.contains_character !== undefined) {
    const ch = q.contains_character;
    if (typeof ch !== 'string' || ch.length !== 1) return res.status(400).json({ detail: 'contains_character must be a single character' });
    clauses.push('instr(value_lower, ?) > 0'); params.push(ch.toLowerCase());
    filtersApplied.contains_character = ch;
  }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const sql = `SELECT * FROM strings ${where} ORDER BY created_at DESC LIMIT 100`;

  try {
    const rows = db.prepare(sql).all(...params);
    const items = rows.map(rowToItem);
    return res.status(200).json({ data: items, count: items.length, filters_applied: Object.keys(filtersApplied).length ? filtersApplied : undefined });
  } catch (err) {
    console.error('DB query error', err);
    return res.status(500).json({ detail: 'Internal Server Error' });
  }
});

// Natural language parsing - basic keyword detection per examples
function parseNlQuery(q) {
  const original = q;
  const lower = q.toLowerCase();
  const parsed = {};

  // single word / one word
  if (/\b(single|one) word\b/.test(lower)) parsed.word_count = 1;

  // palindromic keywords
  if (lower.includes('palindr') || lower.includes('palindrom') || lower.includes('palind')) parsed.is_palindrome = true;

  // longer than N
  let m = lower.match(/longer than (\d+) (characters|chars)?/);
  if (m) parsed.min_length = Number(m[1]) + 1; // heuristic: "longer than 10" -> min_length 11
  else {
    let m2 = lower.match(/longer than (\d+)\b/);
    if (m2) parsed.min_length = Number(m2[1]) + 1;
  }

  // containing letter x / contain x
  let m3 = lower.match(/(?:contain(?:ing)?(?: the)?(?: letter)? )([a-z])\b/);
  if (m3) parsed.contains_character = m3[1];

  // first vowel -> 'a' heuristic
  if (lower.includes('first vowel')) parsed.contains_character = 'a';

  if (Object.keys(parsed).length === 0) {
    throw new Error('Unable to parse natural language query');
  }

  return { original, parsed_filters: parsed };
}

// GET /strings/filter-by-natural-language
app.get('/strings/filter-by-natural-language', (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ detail: 'query parameter is required' });

  let interp;
  try {
    interp = parseNlQuery(query);
  } catch (err) {
    return res.status(400).json({ detail: 'Unable to parse natural language query' });
  }

  const parsed = interp.parsed_filters;
  // check for obvious conflicts
  if ('min_length' in parsed && 'max_length' in parsed) {
    if (parsed.min_length > parsed.max_length) return res.status(422).json({ detail: 'Query parsed but resulted in conflicting filters' });
  }

  // build SQL where clause from parsed
  const clauses = [];
  const params = [];
  if (parsed.is_palindrome) clauses.push('is_palindrome = 1');
  if ('min_length' in parsed) { clauses.push('length >= ?'); params.push(parsed.min_length); }
  if ('max_length' in parsed) { clauses.push('length <= ?'); params.push(parsed.max_length); }
  if ('word_count' in parsed) { clauses.push('word_count = ?'); params.push(parsed.word_count); }
  if ('contains_character' in parsed) { clauses.push('instr(value_lower, ?) > 0'); params.push(parsed.contains_character.toLowerCase()); }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const sql = `SELECT * FROM strings ${where} ORDER BY created_at DESC LIMIT 100`;

  try {
    const rows = db.prepare(sql).all(...params);
    const items = rows.map(rowToItem);
    return res.status(200).json({ data: items, count: items.length, interpreted_query: interp });
  } catch (err) {
    console.error('DB query error', err);
    return res.status(500).json({ detail: 'Internal Server Error' });
  }
});

// -----------------------------
// Error handling
// -----------------------------
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ detail: 'Internal Server Error' });
});

// -----------------------------
// Start server only when run directly
// -----------------------------
if (require.main === module) {
  app.listen(PORT, () => console.log(`String Analyzer API listening on http://localhost:${PORT}`));
}

module.exports = app;
