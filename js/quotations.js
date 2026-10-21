/*
Functions to merge the data of the same quotation at different locations in the Qurʾān
(for example, the basmala at the start of sura 1 and at the start of sura 2),
to count how often each word of a verse is quoted,
and to select the quotations that occur in a verse or a sura.

These functions have no dependencies (no d3, no DOM), so they can be tested with Node
(see test_quotations.js).

A quotation is identified by a *key*: "<sura>.<aya>.<token>.<n>"
 - <sura>.<aya>.<token> is the location of the last word of the quotation in the Qurʾān
   (the token number within the aya is zero-based)
 - <n> is the number of words of the quotation.
This is the format of the keys in resources/first_repeated_quran_ngrams.json, in which the
key of the *first appearance* of an ngram that occurs more than once in the Qurʾān
has as its value a list of the other appearances ("<sura>.<aya>.<token>").
The first appearance is used as the canonical key of the quotation.
*/


/* The key of a quotation.
   qTokensD: {token index in the Qurʾān: [token, "<sura>.<aya>.<token in aya>"]}
   start, end: index of the first and the last token of the quotation in the Qurʾān (both inclusive) */
function quotationKey(qTokensD, start, end) {
    return `${qTokensD[end][1]}.${end - start + 1}`;
}

/* Make a lookup that maps the key of every appearance of a repeated ngram to the key of its first appearance.
   repeatedNgramsD: {key of first appearance: ["<sura>.<aya>.<token>", ...] (the other appearances)} */
function buildRepeatedLookup(repeatedNgramsD) {
    const lookup = {};
    for (const [key, others] of Object.entries(repeatedNgramsD)) {
        const n = key.slice(key.lastIndexOf(".") + 1);
        for (const other of others) {
            lookup[`${other}.${n}`] = key;
        }
    }
    return lookup;
}

/* The key of the first appearance of the quotation in the Qurʾān */
function canonicalKey(key, repeatedLookupD) {
    return repeatedLookupD[key] || key;
}

/* Convert a key into the indexes of the first and the last token of the quotation in the Qurʾān.
   qTokenIndexD: {"<sura>.<aya>.<token in aya>": token index in the Qurʾān} */
function parseQuotationKey(key, qTokenIndexD) {
    const i = key.lastIndexOf(".");
    const n = +key.slice(i + 1);
    const end = qTokenIndexD[key.slice(0, i)];
    return {start: end - n + 1, end: end, n: n};
}

/* Merge the rows for the same quotation at different locations in the Qurʾān.

   rows: [{start_token, end_token, count, ...}, ...] (one row for each location, year, genre, ...)
   Returns: [{key, count}, ...] with the key of the first appearance of each quotation
       and the sum of the counts of all its appearances, sorted from most to least frequent. */
function mergeQuotations(rows, qTokensD, repeatedLookupD) {
    const counts = new Map();
    for (const d of rows) {
        if (!(d.end_token in qTokensD)) {
            continue;
        }
        const key = canonicalKey(quotationKey(qTokensD, d.start_token, d.end_token), repeatedLookupD);
        counts.set(key, (counts.get(key) || 0) + (+d.count));
    }
    return Array.from(counts, ([key, count]) => ({key, count})).sort((a, b) => b.count - a.count);
}

/* For each word of a verse: the number of quotations that contain the word.

   rows: the rows of the file of the verse (data/<sura>.<aya>.csv): [{ngram_start, ngram_length, ...}, ...]
       ngram_start is the (one-based) number of the first word of the quotation in the verse;
       the number of words of the quotation is ngram_length + lengthOffset
       (in the current data, ngram_length is the number of words: lengthOffset = 0;
       in data generated before 2026 it was the number of words minus one: lengthOffset = 1)
   nTokens: the number of words in the verse
   Returns: an array with nTokens counts (the first element is the count of the first word) */
function tokenCounts(rows, nTokens, lengthOffset) {
    const counts = new Array(nTokens).fill(0);
    for (const d of rows) {
        const first = Math.max(d.ngram_start, 1);
        const last = Math.min(d.ngram_start + d.ngram_length + lengthOffset - 1, nTokens);
        for (let i = first; i <= last; i++) {
            counts[i - 1] += 1;
        }
    }
    return counts;
}

/* The first and the last token index of every verse ("<sura>.<aya>") and of every sura ("<sura>").
   qTokensD: {token index in the Qurʾān: [token, "<sura>.<aya>.<token in aya>"]}
   Returns: {verses: {"2.255": [first, last], ...}, suras: {"2": [first, last], ...}} */
function buildRanges(qTokensD) {
    const verses = {};
    const suras = {};
    const nTokens = Object.keys(qTokensD).length;
    for (let i = 0; i < nTokens; i++) {
        const [sura, aya] = qTokensD[i][1].split(".");
        const verse = `${sura}.${aya}`;
        if (verse in verses) { verses[verse][1] = i; } else { verses[verse] = [i, i]; }
        if (sura in suras) { suras[sura][1] = i; } else { suras[sura] = [i, i]; }
    }
    return {verses, suras};
}

/* All appearances of a quotation in the Qurʾān: its first appearance and its other appearances.
   key: key of the first appearance of the quotation
   Returns: [{location: "<sura>.<aya>.<token in aya>" (of the last word), start, end}, ...]
       (start and end: the token indexes of the first and the last word in the Qurʾān),
       the first appearance first */
function appearancesOf(key, repeatedNgramsD, qTokenIndexD) {
    const i = key.lastIndexOf(".");
    const n = +key.slice(i + 1);
    const locations = [key.slice(0, i)].concat(repeatedNgramsD[key] || []);
    const appearances = [];
    for (const location of locations) {
        const end = qTokenIndexD[location];
        if (end !== undefined) {
            appearances.push({location, start: end - n + 1, end});
        }
    }
    return appearances;
}

/* Keep the quotations that occur in a part of the Qurʾān (a verse or a sura).
   A quotation occurs in it if at least one of its appearances has a word in it.

   quotations: [{key, count}, ...] (see mergeQuotations)
   first, last: the first and the last token index of the verse or sura (see buildRanges)
   Returns: [{key, count, appearances}, ...]: the quotations in the same order, with their
       appearances in that part of the Qurʾān (the first one first) */
function filterQuotationsByRange(quotations, repeatedNgramsD, qTokenIndexD, first, last) {
    const result = [];
    for (const q of quotations) {
        const inside = appearancesOf(q.key, repeatedNgramsD, qTokenIndexD)
            .filter(a => a.start <= last && a.end >= first);
        if (inside.length > 0) {
            result.push({key: q.key, count: q.count, appearances: inside});
        }
    }
    return result;
}

/* The quotations of a verse that contain a word of the verse (a click on the word in the heat map).
   The rows of the same quotation (the same ngram_start and ngram_length: the same words of the verse,
   quoted in different texts or in different places of a text) are grouped.
   rows: the rows of the verse file (ngram_start and ngram_length as numbers)
   word: the number of the word in the verse (the first word is 1)
   lengthOffset: see tokenCounts
   Returns: [{start, length, count, nTexts}, ...] sorted by frequency (count: the number of rows;
       nTexts: the number of different texts), then by length (the longest first) */
function quotationsAtWord(rows, word, lengthOffset) {
    const groups = new Map();
    for (const d of rows) {
        const length = d.ngram_length + lengthOffset;
        if (d.ngram_start <= word && word <= d.ngram_start + length - 1) {
            const id = `${d.ngram_start}.${d.ngram_length}`;
            if (!groups.has(id)) {
                groups.set(id, {start: d.ngram_start, length, count: 0, texts: new Set()});
            }
            const g = groups.get(id);
            g.count += 1;
            g.texts.add(d.text_id);
        }
    }
    return Array.from(groups.values(), g => ({start: g.start, length: g.length, count: g.count, nTexts: g.texts.size}))
        .sort((a, b) => b.count - a.count || b.length - a.length || a.start - b.start);
}

/* The texts in which a quotation of a verse (the same words of the verse) is cited.
   rows: the rows of the verse file (ngram_start, ngram_length, text_id, year as numbers/strings)
   start, length: ngram_start and the number of words of the quotation (see quotationsAtWord)
   lengthOffset: see tokenCounts
   Returns: [{textId, year, century, count}, ...] sorted by year (the earliest first), then by text id;
       count: the number of times the text cites the quotation */
function textsOfQuotation(rows, start, length, lengthOffset) {
    const texts = new Map();
    for (const d of rows) {
        if (d.ngram_start === start && d.ngram_length + lengthOffset === length) {
            if (!texts.has(d.text_id)) {
                texts.set(d.text_id, {textId: d.text_id, year: d.year, century: d.century, count: 0});
            }
            texts.get(d.text_id).count += 1;
        }
    }
    return Array.from(texts.values()).sort((a, b) => a.year - b.year || +a.textId - +b.textId);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {quotationKey, buildRepeatedLookup, canonicalKey, parseQuotationKey, mergeQuotations, tokenCounts,
                      buildRanges, appearancesOf, filterQuotationsByRange,
                      quotationsAtWord, textsOfQuotation};
}
