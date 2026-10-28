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

/* A row of a verse file is the part of a quotation that is in the verse: a quotation of several verses has
   a row in the file of each of its verses. These functions find the whole quotation:
   the first and the last word (token index in the Qurʾān: qstart and qend) and the number of words (total).
   The other parts of a quotation are found in the files of the neighbouring verses: they have the same text,
   the same place in the text (text_id, text_tok_start, text_tok_end) and they start or end at the border of the verse. */

/* The identity of a citation: the place in the text that cites the Qurʾān */
function textKey(d) {
    return `${d.text_id}.${d.text_tok_start}.${d.text_tok_end}`;
}

/* The words of a row that are in the verse: {first, last} (the first word of the verse is 1) */
function segmentOf(d, nWords, lengthOffset) {
    const length = d.ngram_length + lengthOffset;
    return {first: Math.max(d.ngram_start, 1), last: Math.min(d.ngram_start + length - 1, nWords)};
}

/* The parts of quotations in a neighbouring verse: the rows of the neighbouring verse that continue
   the quotations (of the verse that the user is looking at) that are looked for.
   neighbourRows: the rows of the neighbouring verse
   wanted: Map: textKey -> the number of words of the quotation that are not found yet
   dir: 1: the neighbour is the next verse (the quotation continues at its first word);
        -1: the neighbour is the previous verse (the quotation continues up to its last word)
   nWords: the number of words of the neighbouring verse
   Returns: Map: textKey -> {words: the number of words in the neighbouring verse,
                             continues: whether the quotation may continue in the verse after it} */
function continuationSegments(neighbourRows, wanted, dir, nWords, lengthOffset) {
    const found = new Map();
    for (const d of neighbourRows) {
        const key = textKey(d);
        if (!wanted.has(key)) continue;
        const seg = segmentOf(d, nWords, lengthOffset);
        const words = seg.last - seg.first + 1;
        if (words < 1 || words > wanted.get(key)) continue;
        if (dir > 0 ? seg.first !== 1 : seg.last !== nWords) continue;   // (it does not continue the quotation)
        const continues = dir > 0 ? seg.last === nWords : seg.first === 1;
        if (!found.has(key) || found.get(key).words < words) {
            found.set(key, {words, continues});
        }
    }
    return found;
}

/* Find the whole quotation of each row of a verse file: add qstart, qend and total to the rows.
   (The text span of a row, text_tok_end - text_tok_start + 1, is the number of words of the whole quotation
   if the text cites the Qurʾān without omissions; the words that are not in this verse must be in the
   neighbouring verses.)
   verse: "<sura>.<aya>"; rows: the rows of its file (ngram_start, ngram_length, text_id, text_tok_start, text_tok_end)
   deps: {loadRows(verse): promise of the rows of the file of a verse,
          neighbour(verse, dir): the previous (dir -1) or the next (dir 1) verse (null if there is none),
          nWords(verse): the number of words of the verse,
          firstToken(verse): the token index of its first word in the Qurʾān,
          lengthOffset: see tokenCounts} */
async function resolveWholeQuotations(verse, rows, deps) {
    if (rows.length === 0 || rows[0].qstart !== undefined) {
        return rows;   // (nothing to do, or done already)
    }
    if (rows[0].quote_start !== undefined && rows[0].quote_start !== "") {
        // newer data: the files have the whole quotation (quote_start, quote_end): no need to look in the neighbouring verses
        rows.forEach(d => {
            d.qstart = +d.quote_start;
            d.qend = +d.quote_end;
            d.total = d.qend - d.qstart + 1;
        });
        return rows;
    }
    const {loadRows, neighbour, nWords, firstToken, lengthOffset} = deps;
    const n = nWords(verse);
    const first = firstToken(verse);
    const wantedBack = new Map();
    const wantedFwd = new Map();
    const info = rows.map(d => {
        const seg = segmentOf(d, n, lengthOffset);
        const textLength = d.text_tok_start === undefined ? 0 : (+d.text_tok_end) - (+d.text_tok_start) + 1;
        // a row that starts before the verse (ngram_start < 1) says how many words precede the verse:
        const known = d.ngram_start < 1 ? 1 - d.ngram_start : 0;
        const rest = textLength - (seg.last - seg.first + 1) - known;   // words that are not found yet
        const key = textKey(d);
        if (rest > 0 && seg.first === 1) wantedBack.set(key, Math.max(rest, wantedBack.get(key) || 0));
        if (rest > 0 && seg.last === n) wantedFwd.set(key, Math.max(rest, wantedFwd.get(key) || 0));
        return {seg, known, rest, key};
    });

    // follow the quotations in the neighbouring verses, as long as they continue:
    async function follow(dir, wanted) {
        const found = new Map();
        let v = wanted.size ? neighbour(verse, dir) : null;
        while (v && wanted.size) {
            let neighbourRows;
            try {
                neighbourRows = await loadRows(v);
            } catch (error) {
                break;
            }
            const segments = continuationSegments(neighbourRows, wanted, dir, nWords(v), lengthOffset);
            const next = new Map();
            for (const [key, {words, continues}] of segments) {
                found.set(key, (found.get(key) || 0) + words);
                const rest = wanted.get(key) - words;
                if (continues && rest > 0) next.set(key, rest);
            }
            wanted = next;
            v = neighbour(v, dir);
        }
        return found;
    }
    const backFound = await follow(-1, wantedBack);
    const fwdFound = await follow(1, wantedFwd);

    rows.forEach((d, i) => {
        const {seg, known, rest, key} = info[i];
        let back = seg.first === 1 ? (backFound.get(key) || 0) : 0;
        let fwd = seg.last === n ? (fwdFound.get(key) || 0) : 0;
        if (back + fwd > rest) {   // (not clear on which side the rest is: keep the longest part)
            if (back >= fwd) { fwd = 0; } else { back = 0; }
        }
        d.qstart = first + seg.first - 1 - known - back;
        d.qend = first + seg.last - 1 + fwd;
        d.total = d.qend - d.qstart + 1;
    });
    return rows;
}

/* The quotations of a verse that contain a word of the verse (a click on the word in the heat map).
   The rows of the same quotation (the same whole quotation: qstart and qend, see resolveWholeQuotations;
   quoted in different texts or in different places of a text) are grouped.
   rows: the rows of the verse file (ngram_start and ngram_length as numbers, qstart and qend)
   word: the number of the word in the verse (the first word is 1)
   lengthOffset: see tokenCounts
   Returns: [{qstart, qend, length, count, nTexts}, ...] sorted by frequency (count: the number of rows;
       nTexts: the number of different texts; length: the number of words of the whole quotation),
       then by length (the longest first) */
function quotationsAtWord(rows, word, lengthOffset) {
    const groups = new Map();
    for (const d of rows) {
        const length = d.ngram_length + lengthOffset;
        if (word === null || (d.ngram_start <= word && word <= d.ngram_start + length - 1)) {   // (null: the whole verse)
            const id = `${d.qstart}.${d.qend}`;
            if (!groups.has(id)) {
                groups.set(id, {qstart: d.qstart, qend: d.qend, count: 0, texts: new Set()});
            }
            const g = groups.get(id);
            g.count += 1;
            g.texts.add(d.text_id);
        }
    }
    return Array.from(groups.values(), g => ({qstart: g.qstart, qend: g.qend, length: g.qend - g.qstart + 1,
                                              count: g.count, nTexts: g.texts.size}))
        .sort((a, b) => b.count - a.count || b.length - a.length || a.qstart - b.qstart);
}

/* The texts in which a quotation of a verse (the same whole quotation) is cited.
   rows: the rows of the verse file (qstart, qend, text_id, year as numbers/strings)
   Returns: [{textId, year, century, count}, ...] sorted by year (the earliest first), then by text id;
       count: the number of times the text cites the quotation */
function textsOfQuotation(rows, qstart, qend) {
    const texts = new Map();
    for (const d of rows) {
        if (d.qstart === qstart && d.qend === qend) {
            if (!texts.has(d.text_id)) {
                texts.set(d.text_id, {textId: d.text_id, year: d.year, century: d.century, count: 0});
            }
            texts.get(d.text_id).count += 1;
        }
    }
    return Array.from(texts.values()).sort((a, b) => a.year - b.year || +a.textId - +b.textId);
}

/* Count the quotations per verse and year (for the graphs of suras and verses).
   A quotation of several verses is counted in each of its verses. The rows are the quotations at their first
   location in the Qurʾān; a quotation that occurs in several places in the Qurʾān (for example the basmala) is
   counted in each place if allLocations is true (the other places are in the dictionary of the repeated ngrams).
   rows: [{start_token, end_token, year, count}, ...] (the rows of @ngrams_count: token indexes in the Qurʾān)
   repeatedNgramsD: key of the first appearance of a quotation: keys of its other appearances
   verseOfToken: the index of the verse of each token index in the Qurʾān (the first verse is 0)
   search (optional, see buildSearch): only the quotations that contain the search term are counted, and only
       in the verses in which the term occurs (not in the other verses of a quotation of several verses)
   Returns: a Map: year * 10000 + the index of the verse -> the number of quotations */
function countByVerse(rows, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, allLocations, search, ignoreImplicit) {
    const counts = new Map();
    const addVerse = (year, v, count) => {
        const id = year * 10000 + v;
        counts.set(id, (counts.get(id) || 0) + count);
    };
    // implicit: the words that an ellipsis only indicates, [[first, last], ...] (token indexes in the Qurʾān):
    // if ignoreImplicit is true, they are not counted
    const add = (year, first, last, count, implicit) => {
        const pieces = ignoreImplicit && implicit ? citedPieces(first, last, implicit) : [[first, last]];
        const verses = new Set();    // (a quotation is counted once in each verse)
        for (const [from, to] of pieces) {
            if (!search) {
                for (let v = verseOfToken[from]; v <= verseOfToken[to]; v++) verses.add(v);
                continue;
            }
            // with a search term: only the verses in which the term occurs:
            for (const o of search.occurrencesIn(from, to)) {
                for (let v = verseOfToken[o.first]; v <= verseOfToken[o.last]; v++) verses.add(v);
            }
        }
        verses.forEach(v => addVerse(year, v, count));
    };
    for (const d of rows) {
        if (!(d.end_token in qTokensD) || !(d.start_token in qTokensD)) continue;
        const implicit = ignoreImplicit ? parseImplicit(d.implicit) : null;
        add(d.year, d.start_token, d.end_token, d.count, implicit);
        if (allLocations) {
            const others = repeatedNgramsD[quotationKey(qTokensD, d.start_token, d.end_token)];
            if (others) {
                const n = d.end_token - d.start_token + 1;
                for (const location of others) {
                    const end = qTokenIndexD[location];
                    if (end !== undefined && end - n + 1 >= 0) {
                        // (the implicit words move with the quotation)
                        const shift = end - d.end_token;
                        add(d.year, end - n + 1, end, d.count, implicit && implicit.map(([a, b]) => [a + shift, b + shift]));
                    }
                }
            }
        }
    }
    return counts;
}

/* The words that an ellipsis only indicates: the column "implicit" of @ngrams_count ("12-15;20-20") as [[12, 15], [20, 20]];
   null if there are none (or no such column in the data) */
function parseImplicit(text) {
    if (!text) return null;
    return text.split(";").map(range => range.split("-").map(Number));
}

/* The words of a quotation (first to last) that are cited: without the implicit words
   implicit: [[first, last], ...] sorted; returns [[first, last], ...] */
function citedPieces(first, last, implicit) {
    const pieces = [];
    let position = first;
    for (const [from, to] of implicit) {
        const a = Math.max(from, position), b = Math.min(to, last);
        if (a > b) continue;
        if (a > position) pieces.push([position, a - 1]);
        position = b + 1;
    }
    if (position <= last) pieces.push([position, last]);
    return pieces;
}

/* Normalise Arabic text for searching: without the vowels and other marks (and the Qurʾānic signs), the tatweel and
   the differences between the forms of the alif, the ya and the hamza */
function normaliseArabic(text) {
    return text
        .replace(/[ـً-ٰٟۖ-ۭ]/g, "")
        .replace(/[آأإٱ]/g, "ا")      // alif with madda, hamza, wasla -> alif
        .replace(/ى/g, "ي")                          // alif maqsura -> ya
        .replace(/ؤ/g, "و")                          // hamza on waw -> waw
        .replace(/ئ/g, "ي")                          // hamza on ya -> ya
        .replace(/ة/g, "ه");                         // ta marbuta -> ha
}

/* Search a term in the text of the Qurʾān.
   term: the normalised search term (see normaliseArabic; a part of a word is found too)
   tokens: the normalised words of the Qurʾān (the index is the token index)
   Returns {occurrences: [{first, last}, ...] (the token indexes of the first and the last word of each occurrence),
            contains(start, end): whether the term occurs in the words start to end (token indexes) of the Qurʾān,
            occurrencesIn(start, end): the occurrences in the words start to end} */
function buildSearch(term, tokens) {
    const offsets = [];
    let text = "";
    tokens.forEach((token, i) => {
        offsets.push(text.length);
        text += token + " ";
    });
    const tokenAt = position => {          // the token at a character position (binary search)
        let lo = 0, hi = offsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (offsets[mid] <= position) lo = mid; else hi = mid - 1;
        }
        return lo;
    };
    const occurrences = [];
    if (term) {
        for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
            const first = tokenAt(i);
            const last = tokenAt(i + term.length - 1);
            if (occurrences.length === 0 || occurrences[occurrences.length - 1].first !== first || occurrences[occurrences.length - 1].last !== last) {
                occurrences.push({first, last});
            }
        }
    }
    // (the occurrences have the same number of words: the first one that starts at or after the start of a
    // quotation is also the first one that ends at or after the start)
    const contains = (start, end) => {
        if (!term) return true;
        let lo = 0, hi = occurrences.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (occurrences[mid].first >= start) hi = mid; else lo = mid + 1;
        }
        return lo < occurrences.length && occurrences[lo].last <= end;
    };
    // the occurrences of the term in the words start to end:
    const occurrencesIn = (start, end) => {
        let lo = 0, hi = occurrences.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (occurrences[mid].first >= start) hi = mid; else lo = mid + 1;
        }
        const found = [];
        for (let i = lo; i < occurrences.length && occurrences[i].first <= end; i++) {
            if (occurrences[i].last <= end) found.push(occurrences[i]);
        }
        return found;
    };
    return {term, occurrences, contains, occurrencesIn};
}

/* Whether a quotation is one of the excluded (frequent) quotations
   excluded: a Set of keys of the first appearance of quotations (see mergeQuotations)
   start, end: the token indexes of the first and the last word of the quotation in the Qurʾān */
function isExcludedQuotation(excluded, qTokensD, repeatedLookupD, start, end) {
    if (excluded.size === 0 || !(end in qTokensD) || !(start in qTokensD)) {
        return false;
    }
    return excluded.has(canonicalKey(quotationKey(qTokensD, start, end), repeatedLookupD));
}

/* Show a citation in its context: the text of the OpenITI milestones.
   The tokens of the texts are counted as the tokenizer of the tagger does (the runs of Arabic letters, ar_tok of the
   openiti package); the OpenITI milestones (https://github.com/OpenITI/i.mech-20) are chunks of 300 of these tokens,
   so token t (zero-based) is, roughly, the word t % 300 of milestone t // 300 + 1 (not exactly: see alignCitation). The milestones are stored in files of 20
   milestones (<text_id>-00020 for ms1-ms20, <text_id>-00040 for ms21-ms40, ...): a tab-separated file with the number
   of the milestone ("ms1") and its text, in which a newline is written as "(@)" and "#" as "(@@)". */
const MECH_URL = "https://raw.githubusercontent.com/OpenITI/i.mech-20";
const MILESTONE_TOKENS = 300;
const MILESTONES_PER_FILE = 20;
const ARABIC_TOKEN = /[ء-غـ-ْٮٰٹپچژکگیے]+/g;

/* The id of a text in the i.mech-20 files: the last part of the version URI,
   "0458Bayhaqi.Ictiqad.JK000698-ara1.completed" -> "JK000698-ara1.completed" */
function textIdOfUri(uri) {
    return uri.split(".").slice(2).join(".");
}

/* The milestone (the first is 1) of a token (the first is 0) */
function milestoneOfToken(token) {
    return Math.floor(token / MILESTONE_TOKENS) + 1;
}

/* The number in the name of the file that has a milestone: 20 for ms1-ms20, 40 for ms21-ms40, ... */
function milestoneFileNumber(milestone) {
    return Math.ceil(milestone / MILESTONES_PER_FILE) * MILESTONES_PER_FILE;
}

/* The url of the file that has a milestone (release: "2023_1_8"; the tag of the i.mech-20 repository is "v2023.1.8") */
function milestoneFileUrl(release, textId, milestone) {
    const nr = String(milestoneFileNumber(milestone)).padStart(5, "0");
    return `${MECH_URL}/v${release.replaceAll("_", ".")}/data/${textId}-${nr}`;
}

/* The text of the milestones of a file as a Map: the number of the milestone -> its text */
function parseMilestoneFile(raw) {
    const milestones = new Map();
    for (const line of raw.split(/\r?\n/)) {
        const tab = line.indexOf("\t");
        const match = tab > 0 && /^ms(\d+)$/.exec(line.slice(0, tab));
        if (match) {
            milestones.set(+match[1], line.slice(tab + 1));
        }
    }
    return milestones;
}

/* A text of the milestones as plain text: with line breaks (and without the marks for the "#" of the OpenITI markup) */
function cleanMilestoneText(text) {
    return text.replace(/\(@@\)/g, "").replace(/\(@\)/g, "\n").replace(/[ \t]*\n[ \t\n]*/g, "\n");
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* The milestones do not have exactly 300 tokens each (a few have 299, 301 or 302), so the estimate of the milestone of a
   token (milestoneOfToken) and the position of the token in the milestones can be off by a few words, more so
   in a long text. The citation is therefore searched in the words around the estimated position: it is placed where
   most words of the Qurʾān are found in it (see alignCitation). */
const MAX_SHIFT = 60;

/* The shift (in words) between the position of a citation in the text (token index) and its position in the
   milestones, where the words of the citation contain most of the words of the Qurʾān (the smallest shift if
   there are more).
   tokens: Map: estimated token index (see contextAround) -> the word
   quranWords: the words of the quotation in the Qurʾān
   Returns {shift, matches}: matches is false if less than half of the words of the Qurʾān are found at any shift
       (then the shift is 0) */
function alignCitation(tokens, firstToken, lastToken, quranWords) {
    const wanted = new Set(quranWords.map(normaliseArabic));
    if (wanted.size === 0) {
        return {shift: 0, matches: true};
    }
    const normalised = new Map();
    const normalisedToken = i => {
        if (!normalised.has(i)) {
            normalised.set(i, tokens.has(i) ? normaliseArabic(tokens.get(i)) : null);
        }
        return normalised.get(i);
    };
    const score = shift => {
        const found = new Set();
        for (let i = firstToken + shift; i <= lastToken + shift; i++) {
            const word = normalisedToken(i);
            if (word !== null && wanted.has(word)) {
                found.add(word);
            }
        }
        return found.size;
    };
    let best = {shift: 0, score: score(0)};
    for (let d = 1; d <= MAX_SHIFT && best.score < wanted.size; d++) {
        for (const shift of [-d, d]) {
            const s = score(shift);
            if (s > best.score) {
                best = {shift, score: s};
            }
        }
    }
    return best.score * 2 >= wanted.size ? {shift: best.shift, matches: true} : {shift: 0, matches: false};
}

/* The milestone borders: the milestones are not exactly 300 tokens long. The file @milestone_borders_<release>.json
   (made by quran-tag/helpers/milestone_borders.py) has for each text the places where the milestones deviate:
   shifts = [[milestone, shift], ...]: milestone m (the first is 1) starts at token 300 * (m - 1) + shift,
   where shift is that of the last pair with a milestone number <= m (0 before the first pair).
   (Texts that are not in the file have milestones of exactly 300 tokens.) */

/* The number of tokens by which a milestone starts later than 300 * (milestone - 1) */
function borderShift(milestone, shifts) {
    let shift = 0;
    for (const [m, s] of shifts) {
        if (m > milestone) {
            break;
        }
        shift = s;
    }
    return shift;
}

/* The index of the first token of a milestone */
function milestoneStart(milestone, shifts) {
    return MILESTONE_TOKENS * (milestone - 1) + borderShift(milestone, shifts);
}

/* The milestone of a token (the first is 1), with the shifts of the text: see milestoneOfToken for the estimate */
function exactMilestoneOfToken(token, shifts) {
    let first = 1;
    let next = null;
    for (const [m] of shifts) {
        if (milestoneStart(m, shifts) > token) {
            next = m;
            break;
        }
        first = m;
    }
    const milestone = first + Math.floor((token - milestoneStart(first, shifts)) / MILESTONE_TOKENS);
    // (the milestone before a shift can be longer than 300 tokens)
    return next === null ? milestone : Math.min(milestone, next - 1);
}

/* The milestones that have the words from nBefore words before the first token to nAfter words after the last token.
   shifts (optional): see above; without them the milestones are estimated, with a margin (see MAX_SHIFT) */
function milestonesAround(firstToken, lastToken, nBefore, nAfter, shifts) {
    const margin = shifts ? 0 : MAX_SHIFT;
    const from = Math.max(0, firstToken - nBefore - margin);
    const to = lastToken + nAfter + margin;
    return shifts ? [exactMilestoneOfToken(from, shifts), exactMilestoneOfToken(to, shifts)]
                  : [milestoneOfToken(from), milestoneOfToken(to)];
}

/* The words of a citation, with some words before and after it, from the text of the milestones.
   milestones: Map: number of the milestone -> its text (it must have the milestones of the citation)
   firstToken, lastToken: the first and the last word of the citation (zero-based token index in the text)
   nBefore, nAfter: the number of words to add before and after the citation
   quranWords (optional): the words of the quotation in the Qurʾān: they are used to check that the right words are
       found, or (without shifts) to find the exact place of the citation (see alignCitation)
   shifts (optional): the milestone borders of the text (see above). Without them, the milestones are supposed to have
       300 tokens, which is not exact: the words of the Qurʾān are then used to correct the place of the citation.
   Returns null if the milestones of the citation are not there; otherwise
       {before, quote, after (the texts), quoteTokens (the words of the citation),
        shift (the number of words that the citation is displaced in the milestones: always 0 with shifts),
        matchesQuran (false if the words of the Qurʾān are not found in the citation)} */
function contextAround(milestones, firstToken, lastToken, nBefore, nAfter, quranWords, shifts) {
    const [first, last] = milestonesAround(firstToken, lastToken, nBefore, nAfter, shifts);
    let text = "";
    const spans = new Map();    // token index -> {start, end} in text
    const tokens = new Map();   // token index -> the word
    for (let ms = first; ms <= last; ms++) {
        if (!milestones.has(ms)) {
            continue;
        }
        const own = milestones.get(ms);
        const firstOfMilestone = shifts ? milestoneStart(ms, shifts) : (ms - 1) * MILESTONE_TOKENS;
        Array.from(own.matchAll(ARABIC_TOKEN)).forEach((m, k) => {
            const i = firstOfMilestone + k;
            spans.set(i, {start: text.length + m.index, end: text.length + m.index + m[0].length});
            tokens.set(i, m[0]);
        });
        text += own;
    }
    const aligned = quranWords ? alignCitation(tokens, firstToken, lastToken, quranWords) : {shift: 0, matches: true};
    // (with the shifts the place is exact: the words of the Qurʾān are only a check)
    const shift = shifts ? 0 : aligned.shift;
    const matches = shifts ? aligned.matches && aligned.shift === 0 : aligned.matches;
    const firstShifted = firstToken + shift;
    const lastShifted = lastToken + shift;
    if (!spans.has(firstShifted) || !spans.has(lastShifted)) {
        return null;
    }
    // (at the start and the end of the text there are fewer words than wanted)
    let from = firstShifted;
    while (from > firstShifted - nBefore && spans.has(from - 1)) from--;
    let to = lastShifted;
    while (to < lastShifted + nAfter && spans.has(to + 1)) to++;
    const quoteStart = spans.get(firstShifted).start;
    const quoteEnd = spans.get(lastShifted).end;
    const quoteTokens = [];
    for (let t = firstShifted; t <= lastShifted; t++) {
        quoteTokens.push(tokens.has(t) ? tokens.get(t) : "");
    }
    return {before: cleanMilestoneText(text.slice(spans.get(from).start, quoteStart)),
            quote: cleanMilestoneText(text.slice(quoteStart, quoteEnd)),
            after: cleanMilestoneText(text.slice(quoteEnd, spans.get(to).end)),
            quoteTokens, shift, matchesQuran: matches};
}

/* Load the context of a citation (see contextAround) from the i.mech-20 repository.
   fetchText(url): promise of the text of a file (it rejects if there is no such file)
   Returns a promise of the result of contextAround;
   it rejects if the file of the citation itself is not found. */
async function loadCitationContext(release, textId, firstToken, lastToken, nBefore, nAfter, fetchText, quranWords, shifts) {
    const [first, last] = milestonesAround(firstToken, lastToken, nBefore, nAfter, shifts);
    const ownUrl = milestoneFileUrl(release, textId, shifts ? exactMilestoneOfToken(firstToken, shifts) : milestoneOfToken(firstToken));
    const urls = new Set();
    for (let ms = first; ms <= last; ms++) {
        urls.add(milestoneFileUrl(release, textId, ms));
    }
    // (the context can be in a file that does not exist: the file after the end of the text)
    const files = await Promise.all(Array.from(urls, url => fetchText(url).then(parseMilestoneFile,
        error => url === ownUrl ? Promise.reject(error) : new Map())));
    const milestones = new Map();
    files.forEach(file => file.forEach((text, ms) => milestones.set(ms, text)));
    return contextAround(milestones, firstToken, lastToken, nBefore, nAfter, quranWords, shifts);
}

/* The places in a text that cite a quotation of a verse (the same whole quotation): [{start, end}, ...]
   (the first and the last token of the citation in the text, as numbers), the first in the text first */
function citationsOfText(rows, qstart, qend, textId) {
    const places = new Map();
    for (const d of rows) {
        if (d.qstart === qstart && d.qend === qend && d.text_id === textId) {
            places.set(textKey(d), {start: +d.text_tok_start, end: +d.text_tok_end});
        }
    }
    return Array.from(places.values()).sort((a, b) => a.start - b.start);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {quotationKey, buildRepeatedLookup, canonicalKey, parseQuotationKey, mergeQuotations, tokenCounts,
                      buildRanges, appearancesOf, filterQuotationsByRange,
                      textKey, segmentOf, continuationSegments, resolveWholeQuotations,
                      quotationsAtWord, textsOfQuotation, countByVerse, parseImplicit, citedPieces, normaliseArabic, buildSearch, isExcludedQuotation,
                      textIdOfUri, milestoneOfToken, milestoneFileNumber, milestoneFileUrl, parseMilestoneFile,
                      cleanMilestoneText, escapeHtml, alignCitation, contextAround, loadCitationContext, citationsOfText,
                      borderShift, milestoneStart, exactMilestoneOfToken};
}
