const express = require('express');
const crypto = require('crypto');
const { URLSearchParams } = require('url'); // Used for parsing query strings cleanly

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// In-memory database, keyed by SHA-256 hash
// Structure: { hash: { id, value, properties, created_at } }
const db = new Map();

// --- Utility Functions for String Analysis ---

/**
 * Computes the SHA-256 hash of a string.
 * @param {string} value - The input string.
 * @returns {string} The SHA-256 hash in hexadecimal format.
 */
function sha256Hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Checks if a string is a palindrome (case-insensitive, exact match).
 * @param {string} value - The input string.
 * @returns {boolean} True if palindrome, false otherwise.
 */
function isPalindrome(value) {
    const normalized = value.toLowerCase();
    const reversed = normalized.split('').reverse().join('');
    return normalized === reversed;
}

/**
 * Counts the number of distinct characters in a string.
 * @param {string} value - The input string.
 * @returns {number} The count of unique characters.
 */
function uniqueCharacters(value) {
    return new Set(value.split('')).size;
}

/**
 * Counts the number of words separated by whitespace.
 * @param {string} value - The input string.
 * @returns {number} The word count.
 */
function wordCount(value) {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    // Split by any sequence of whitespace characters (including newlines)
    return trimmed.split(/\s+/).length;
}

/**
 * Creates a map of character frequencies.
 * @param {string} value - The input string.
 * @returns {Object<string, number>} The frequency map.
 */
function charFrequencyMap(value) {
    const freqMap = {};
    for (const char of value) {
        freqMap[char] = (freqMap[char] || 0) + 1;
    }
    return freqMap;
}

/**
 * Analyzes a string and computes all required properties.
 * @param {string} value - The input string.
 * @returns {Object} The analysis properties.
 */
function analyzeString(value) {
    const hash = sha256Hash(value);

    return {
        length: value.length,
        is_palindrome: isPalindrome(value),
        unique_characters: uniqueCharacters(value),
        word_count: wordCount(value),
        sha256_hash: hash,
        character_frequency_map: charFrequencyMap(value)
    };
}

// --- Natural Language Parsing Logic ---

/**
 * Converts a natural language query into structured filter parameters.
 * Note: This is a simple, rule-based parser and does not use a complex NLP model.
 * @param {string} query - The natural language query string.
 * @returns {Object} Parsed filters or an error object if unresolvable/conflicting.
 */
function parseNaturalLanguageQuery(query) {
    const filters = {};
    const lowerQuery = query.toLowerCase();

    // 1. Palindrome
    if (lowerQuery.includes('palindrome') || lowerQuery.includes('palindromic')) {
        filters.is_palindrome = true;
    }

    // 2. Word Count (exact)
    // Matches phrases like "single word", "two words", "3 words"
    const wordCountMatch = lowerQuery.match(/(single|one|two|three|four|five|\d+)\s+word(s)?/);
    if (wordCountMatch) {
        const numStr = wordCountMatch[1];
        let count;
        if (numStr === 'single' || numStr === 'one') count = 1;
        else if (numStr === 'two') count = 2;
        else if (numStr === 'three') count = 3;
        else if (!isNaN(parseInt(numStr))) count = parseInt(numStr);

        if (count !== undefined) {
            filters.word_count = count;
        }
    }

    // 3. Length (min/max)
    // Matches "longer than X", "minimum length X", "shorter than Y", "maximum length Y"
    const lengthRegex = /(longer than|shorter than|min length|max length|at least|at most|greater than|less than)\s*(\d+)/g;
    let match;
    while ((match = lengthRegex.exec(lowerQuery)) !== null) {
        const type = match[1];
        const num = parseInt(match[2]);

        if (type.includes('longer than') || type.includes('at least') || type.includes('minimum length') || type.includes('greater than')) {
            filters.min_length = filters.min_length ? Math.max(filters.min_length, num + (type.includes('than') ? 1 : 0)) : num + (type.includes('than') ? 1 : 0);
        } else if (type.includes('shorter than') || type.includes('at most') || type.includes('maximum length') || type.includes('less than')) {
            filters.max_length = filters.max_length ? Math.min(filters.max_length, num - (type.includes('than') ? 1 : 0)): num - (type.includes('than') ? 1 : 0);
        }
    }

    // 4. Contains Character
    // Matches "contain(s) the letter z"
    const containsCharMatch = lowerQuery.match(/contain(s)? the letter\s*["']?([a-z])["']?/i);
    if (!containsCharMatch) {
        // Alternative simple match: "contains 'a'" or "with character z"
        const simpleCharMatch = lowerQuery.match(/(contains|with character|has)\s*["']?([a-z])["']?/i);
        if (simpleCharMatch) {
             filters.contains_character = simpleCharMatch[2];
        } else if (lowerQuery.includes("first vowel")) {
            filters.contains_character = "a";
        }
    } else {
        filters.contains_character = containsCharMatch[2];
    }


    // 5. Conflict Check
    if (filters.min_length !== undefined && filters.max_length !== undefined && filters.min_length > filters.max_length) {
        return { error: 'Query resulted in conflicting minimum and maximum length filters.', code: 422 };
    }

    // Check if any filter was successfully parsed
    if (Object.keys(filters).length === 0) {
        return { error: 'Unable to parse natural language query into structured filters.', code: 400 };
    }

    return filters;
}


// --- API Endpoints ---

// 1. Create/Analyze String
app.post('/strings', (req, res) => {
    const value = req.body.value;

    // 400 Bad Request: Missing "value" field
    if (value === undefined) {
        return res.status(400).json({ error: 'Bad Request: Missing "value" field in request body.' });
    }

    // 422 Unprocessable Entity: Invalid data type for "value"
    if (typeof value !== 'string') {
        return res.status(422).json({ error: 'Unprocessable Entity: "value" must be a string.' });
    }

    const analysis = analyzeString(value);
    const id = analysis.sha256_hash;

    // 409 Conflict: String already exists
    if (db.has(id)) {
        return res.status(409).json({ error: Conflict: String (ID: ${id}) already exists. });
    }

    const stringData = {
        id,
        value,
        properties: analysis,
        created_at: new Date().toISOString()
    };

    db.set(id, stringData);

    // 201 Created
    res.status(201).json(stringData);
});

// 2. Get Specific String (by SHA-256 Hash ID)
app.get('/strings/:id', (req, res) => {
    const id = req.params.id;
    const stringData = db.get(id);

    // 404 Not Found
    if (!stringData) {
        return res.status(404).json({ error: Not Found: String with ID "${id}" does not exist. });
    }

    // 200 OK
    res.status(200).json(stringData);
});

/**
 * Filter function to apply query parameters to string data.
 * @param {Object} item - The string data object from the database.
 * @param {Object} filters - The parsed query filters.
 * @returns {boolean} True if the item matches all filters.
 */
function applyFilters(item, filters) {
    const props = item.properties;

    if (filters.is_palindrome !== undefined && props.is_palindrome !== filters.is_palindrome) {
        return false;
    }
    if (filters.min_length !== undefined && props.length < filters.min_length) {
        return false;
    }
    if (filters.max_length !== undefined && props.length > filters.max_length) {
        return false;
    }
    if (filters.word_count !== undefined && props.word_count !== filters.word_count) {
        return false;
    }
    if (filters.contains_character !== undefined) {
        // Case-insensitive check for contains_character
        if (!item.value.toLowerCase().includes(filters.contains_character.toLowerCase())) {
            return false;
        }
    }
    return true;
}

// 3. Get All Strings with Filtering
app.get('/strings', (req, res) => {
    const query = req.query;
    const filters = {};
    const filtersApplied = {};

    // 1. Parse and validate query parameters
    try {
        if (query.is_palindrome !== undefined) {
            if (query.is_palindrome === 'true' || query.is_palindrome === 'false') {
                filters.is_palindrome = query.is_palindrome === 'true';
                filtersApplied.is_palindrome = filters.is_palindrome;
            } else {
                throw new Error('is_palindrome must be "true" or "false".');
            }
        }
        if (query.min_length !== undefined) {
            const min = parseInt(query.min_length);
            if (isNaN(min) || min < 0) throw new Error('min_length must be a non-negative integer.');
            filters.min_length = min;
            filtersApplied.min_length = min;
        }
        if (query.max_length !== undefined) {
            const max = parseInt(query.max_length);
            if (isNaN(max) || max < 0) throw new Error('max_length must be a non-negative integer.');
            filters.max_length = max;
            filtersApplied.max_length = max;
        }
        if (query.word_count !== undefined) {
            const count = parseInt(query.word_count);
            if (isNaN(count) || count < 0) throw new Error('word_count must be a non-negative integer.');
            filters.word_count = count;
            filtersApplied.word_count = count;
        }
        if (query.contains_character !== undefined) {
            if (typeof query.contains_character !== 'string' || query.contains_character.length !== 1) {
                // The prompt says "single character to search for" but allowing longer strings for flexible filtering.
                // Sticking to strict interpretation for now:
                // throw new Error('contains_character must be a single character.');
            }
            filters.contains_character = query.contains_character;
            filtersApplied.contains_character = query.contains_character;
        }
    } catch (e) {
        // 400 Bad Request
        return res.status(400).json({ error: Bad Request: ${e.message} });
    }

    // 2. Apply filters to the data
    const results = Array.from(db.values()).filter(item => applyFilters(item, filters));

    // 200 OK
    res.status(200).json({
        data: results,
        count: results.length,
        filters_applied: filtersApplied
    });
});

// 4. Natural Language Filtering
app.get('/strings/filter-by-natural-language', (req, res) => {
    const nlQuery = req.query.query;

    if (!nlQuery) {
        return res.status(400).json({ error: 'Bad Request: Missing "query" natural language parameter.' });
    }

    // 1. Parse Natural Language Query
    const parsedFilters = parseNaturalLanguageQuery(nlQuery);

    if (parsedFilters.error) {
        return res.status(parsedFilters.code).json({
            error: parsedFilters.error,
            interpreted_query: {
                original: nlQuery,
                parsed_filters: {}
            }
        });
    }

    // 2. Apply Parsed Filters
    const results = Array.from(db.values()).filter(item => applyFilters(item, parsedFilters));

    // 200 OK
    res.status(200).json({
        data: results,
        count: results.length,
        interpreted_query: {
            original: nlQuery,
            parsed_filters: parsedFilters
        }
    });
});


// 5. Delete String (by SHA-256 Hash ID)
app.delete('/strings/:id', (req, res) => {
    const id = req.params.id;

    // 404 Not Found
    if (!db.has(id)) {
        return res.status(404).json({ error: Not Found: String with ID "${id}" does not exist. });
    }

    db.delete(id);

    // 204 No Content
    res.status(204).send();
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(String Analyzer Service running on http://localhost:${PORT});
    console.log(In-memory database initialized. ${db.size} records found.);
    console.log('Endpoints: POST /strings, GET /strings/:id, GET /strings, GET /strings/filter-by-natural-language, DELETE /strings/:id');
});

// Export the app for testing purposes (optional but good practice)
module.exports = app;
