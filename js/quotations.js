/*
Functions to merge the data of the same quotation at different locations in the Qurʾān
(for example, the basmala at the start of sura 1 and at the start of sura 2),
and to count how often each word of a verse is quoted.

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
       (in the current data, ngram_length is the number of words minus one: lengthOffset = 1)
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

if (typeof module !== "undefined" && module.exports) {
    module.exports = {quotationKey, buildRepeatedLookup, canonicalKey, parseQuotationKey, mergeQuotations, tokenCounts};
}
