/*
Tests for js/quotations.js, with the data of the app (resources/ and data/).

Run in the quran-viz folder with:   node --test js/test_quotations.js
*/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {quotationKey, buildRepeatedLookup, canonicalKey, parseQuotationKey, mergeQuotations, tokenCounts,
    buildRanges, appearancesOf, filterQuotationsByRange,
    textKey, segmentOf, continuationSegments, resolveWholeQuotations,
    quotationsAtWord, textsOfQuotation, countByVerse, parseImplicit, citedPieces, normaliseArabic, buildSearch, isExcludedQuotation,
    textIdOfUri, milestoneOfToken, milestoneFileNumber, milestoneFileUrl, parseMilestoneFile, cleanMilestoneText, escapeHtml,
    alignCitation, contextAround, loadCitationContext, citationsOfText,
    borderShift, milestoneStart, exactMilestoneOfToken} = require("./quotations.js");

const release = "2023_1_8";

// the lookups that script.js builds from the text of the Qurʾān:
const ayaTextD = {};
const qTokensD = {};
const qTokenIndexD = {};
let qtoken = 0;
for (const line of fs.readFileSync(path.join(__dirname, "..", "resources", "quran-simple.txt"), "utf-8").split(/\r?\n/)) {
    const [sura, aya, ayaText] = line.split("|");
    if (!/^\d+$/.test(sura) || ayaText === undefined) {
        continue;   // (the copyright footer)
    }
    const suraAya = `${sura}.${aya}`;
    ayaTextD[suraAya] = ayaText;
    ayaText.split(" ").forEach((token, j) => {
        qTokensD[qtoken] = [token, `${suraAya}.${j + 1}`];
        qTokenIndexD[`${suraAya}.${j + 1}`] = qtoken;
        qtoken += 1;
    });
}
const repeatedNgramsD = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "resources", "first_repeated_quran_ngrams.json"), "utf-8")).data;
const repeatedLookupD = buildRepeatedLookup(repeatedNgramsD);

function readNgrams() {
    const lines = fs.readFileSync(path.join(__dirname, "..", "data", `@ngrams_count_${release}.csv`), "utf-8").split(/\r?\n/);
    const rows = [];
    for (const line of lines.slice(1)) {
        if (!line) continue;
        const [start, end, year, genre, geography, count] = line.split(",");
        rows.push({start_token: +start, end_token: +end, year: +year, count: +count});
    }
    return rows;
}

test("the key of a quotation", () => {
    assert.strictEqual(quotationKey(qTokensD, 0, 3), "1.1.4.4");       // the basmala of sura 1 (4 words)
    assert.strictEqual(quotationKey(qTokensD, 29, 32), "2.1.4.4");     // the basmala at the start of 2:1
    assert.strictEqual(quotationKey(qTokensD, 4, 7), "1.2.4.4");       // 1:2
});

test("the key of the first appearance", () => {
    const first = "1.1.4.4";
    assert.ok(repeatedNgramsD[first].length > 100, "the basmala occurs in more than 100 other verses");
    assert.strictEqual(canonicalKey("2.1.4.4", repeatedLookupD), first);
    assert.strictEqual(canonicalKey(first, repeatedLookupD), first);
    for (const other of repeatedNgramsD[first]) {
        assert.strictEqual(canonicalKey(`${other}.4`, repeatedLookupD), first, other);
    }
});

test("a quotation that occurs once is its own first appearance", () => {
    const key = quotationKey(qTokensD, 29, 32 + 40);    // (a long ngram from 2:1 onwards)
    assert.strictEqual(canonicalKey(key, repeatedLookupD), key);
});

test("an ngram that is shorter or longer is not the same quotation", () => {
    // the bigram "الله الرحمن" and the 4-gram basmala end at the same token, but are different quotations
    const bigram = quotationKey(qTokensD, 2, 3);
    const basmala = quotationKey(qTokensD, 0, 3);
    assert.notStrictEqual(canonicalKey(bigram, repeatedLookupD), canonicalKey(basmala, repeatedLookupD));
});

test("keys can be converted back into token indexes", () => {
    for (const [start, end] of [[0, 3], [29, 32], [4, 7], [2821, 2825], [76944, 76947]]) {
        const key = quotationKey(qTokensD, start, end);
        assert.deepStrictEqual(parseQuotationKey(key, qTokenIndexD), {start, end, n: end - start + 1});
    }
});

test("merging rows (a small example)", () => {
    const rows = [
        {start_token: 0, end_token: 3, count: 10, year: 1},      // basmala 1:1
        {start_token: 0, end_token: 3, count: 5, year: 2},       // (the same, other year)
        {start_token: 29, end_token: 32, count: "7", year: 1},   // basmala 2:1 (a count that is a string)
        {start_token: 4, end_token: 7, count: 8, year: 1},       // 1:2
    ];
    assert.deepStrictEqual(mergeQuotations(rows, qTokensD, repeatedLookupD), [
        {key: "1.1.4.4", count: 22},
        {key: "1.2.4.4", count: 8},
    ]);
});

test("rows without a known end token are ignored", () => {
    assert.deepStrictEqual(mergeQuotations([{start_token: 0, end_token: 10 ** 7, count: 1}], qTokensD, repeatedLookupD), []);
});

test("the data of the app", () => {
    const rows = readNgrams();
    const merged = mergeQuotations(rows, qTokensD, repeatedLookupD);

    // no counts are lost or counted twice:
    const total = rows.reduce((sum, d) => sum + d.count, 0);
    assert.strictEqual(merged.reduce((sum, q) => sum + q.count, 0), total);

    // fewer quotations than different (start, end) pairs, and sorted by frequency:
    const pairs = new Set(rows.map(d => `${d.start_token}-${d.end_token}`));
    assert.ok(merged.length < pairs.size, `${merged.length} merged quotations, ${pairs.size} different locations`);
    for (let i = 1; i < merged.length; i++) {
        assert.ok(merged[i - 1].count >= merged[i].count);
    }

    // every quotation has the key of its first appearance:
    for (const q of merged) {
        assert.strictEqual(repeatedLookupD[q.key], undefined, q.key);
    }

    // the basmala at the start of sura 1 and at the start of sura 2 have been merged:
    const basmalaRows = rows.filter(d => (d.start_token === 0 && d.end_token === 3) || (d.start_token === 29 && d.end_token === 32));
    const basmalaTotal = basmalaRows.reduce((sum, d) => sum + d.count, 0);
    assert.strictEqual(merged[0].key, "1.1.4.4");
    assert.strictEqual(merged[0].count, basmalaTotal);
    assert.strictEqual(merged.filter(q => q.key === "2.1.4.4").length, 0);

    // its text and the number of other verses:
    const basmala = parseQuotationKey(merged[0].key, qTokenIndexD);
    assert.strictEqual(basmala.n, 4);
    assert.strictEqual(repeatedNgramsD[merged[0].key].length, 113);
    const words = [];
    for (let i = basmala.start; i <= basmala.end; i++) words.push(qTokensD[i][0]);
    assert.strictEqual(words.length, 4);
    assert.strictEqual(words[1].replace(/[ً-ٰٟ]/g, ""), "الله");
});

test("every location in the data has a key that can be converted back into the same tokens", () => {
    const rows = readNgrams();
    const seen = new Set();
    for (const d of rows) {
        const id = `${d.start_token}-${d.end_token}`;
        if (seen.has(id) || !(d.end_token in qTokensD)) continue;
        seen.add(id);
        const parsed = parseQuotationKey(quotationKey(qTokensD, d.start_token, d.end_token), qTokenIndexD);
        assert.deepStrictEqual([parsed.start, parsed.end], [d.start_token, d.end_token], id);
    }
    assert.ok(seen.size > 100000);
});

test("counting the quotations that contain each word of a verse (a small example)", () => {
    // verse of 5 words; ngram_length is the number of words minus one
    const rows = [
        {ngram_start: 1, ngram_length: 3},   // words 1-4
        {ngram_start: 1, ngram_length: 4},   // words 1-5
        {ngram_start: 5, ngram_length: 0},   // word 5
        {ngram_start: 2, ngram_length: 1},   // words 2-3
    ];
    assert.deepStrictEqual(tokenCounts(rows, 5, 1), [2, 3, 3, 2, 2]);
    // if ngram_length is the number of words:
    const rows2 = rows.map(d => ({...d, ngram_length: d.ngram_length + 1}));
    assert.deepStrictEqual(tokenCounts(rows2, 5, 0), [2, 3, 3, 2, 2]);
});

test("counting: quotations that go beyond the verse or start before it", () => {
    assert.deepStrictEqual(tokenCounts([{ngram_start: 3, ngram_length: 10}], 5, 1), [0, 0, 1, 1, 1]);
    assert.deepStrictEqual(tokenCounts([{ngram_start: 0, ngram_length: 2}], 5, 1), [1, 1, 0, 0, 0]);
    assert.deepStrictEqual(tokenCounts([], 3, 1), [0, 0, 0]);
});

test("counting: verses with more than 100 words", () => {
    const counts = tokenCounts([{ngram_start: 120, ngram_length: 7}], 128, 1);
    assert.strictEqual(counts.length, 128);
    assert.strictEqual(counts.filter(c => c === 1).length, 8);
    assert.ok(!counts.some(Number.isNaN));
});

test("counting: the verse files of the app", () => {
    // verse 2:1 has 5 words: the basmala (4 words) and "alif lam mim"
    const readVerse = name => fs.readFileSync(path.join(__dirname, "..", "data", `${name}.csv`), "utf-8")
        .split(String.fromCharCode(10)).map(l => l.trim()).slice(1).filter(Boolean)
        .map(l => { const p = l.split(","); return {ngram_start: +p[0], ngram_length: +p[1]}; });
    const rows = readVerse("2.1");
    const counts = tokenCounts(rows, 5, 0);
    assert.strictEqual(counts.length, 5);
    // the quotations of the basmala cover the first 4 words, the whole verse also the fifth:
    const wholeVerse = rows.filter(d => d.ngram_start === 1 && d.ngram_length === 5).length;
    const basmala = rows.filter(d => d.ngram_start === 1 && d.ngram_length === 4).length;
    assert.ok(wholeVerse > 100 && basmala > 10000);
    assert.ok(counts[0] >= wholeVerse + basmala);
    assert.ok(counts[4] >= wholeVerse && counts[4] < counts[0]);
    // the total number of counts is the total number of words that the rows cover:
    const covered = rows.reduce((sum, d) => sum + Math.min(d.ngram_length, 5 - d.ngram_start + 1), 0);
    assert.strictEqual(counts.reduce((a, b) => a + b, 0), covered);

    // the longest verse (2:282, more than 100 words):
    const counts282 = tokenCounts(readVerse("2.282"), 128, 0);
    assert.strictEqual(counts282.length, 128);
    assert.ok(!counts282.some(Number.isNaN));
});

test("the first and the last token of verses and suras", () => {
    const ranges = buildRanges(qTokensD);
    assert.deepStrictEqual(ranges.verses["1.1"], [0, 3]);
    assert.deepStrictEqual(ranges.verses["1.2"], [4, 7]);
    assert.deepStrictEqual(ranges.verses["2.1"], [29, 33]);       // the basmala and "alif lam mim"
    assert.deepStrictEqual(ranges.suras["1"], [0, 28]);
    assert.strictEqual(ranges.suras["2"][0], 29);
    assert.strictEqual(ranges.suras["114"][1], qtoken - 1);       // the last word of the Qurʾān
    assert.strictEqual(Object.keys(ranges.suras).length, 114);
    assert.strictEqual(Object.keys(ranges.verses).length, 6236);
    // the ranges follow each other:
    assert.strictEqual(ranges.suras["3"][0], ranges.suras["2"][1] + 1);
});

test("all appearances of a quotation", () => {
    const appearances = appearancesOf("1.1.4.4", repeatedNgramsD, qTokenIndexD);
    assert.strictEqual(appearances.length, 1 + repeatedNgramsD["1.1.4.4"].length);
    assert.deepStrictEqual(appearances[0], {location: "1.1.4", start: 0, end: 3});
    assert.deepStrictEqual(appearances[1], {location: "2.1.4", start: 29, end: 32});
    // a quotation that occurs once has one appearance:
    const key = quotationKey(qTokensD, 29, 32 + 40);
    assert.strictEqual(appearancesOf(key, repeatedNgramsD, qTokenIndexD).length, 1);
});

test("selecting the quotations of a verse or sura (a small example)", () => {
    const ranges = buildRanges(qTokensD);
    const quotations = [
        {key: "1.1.4.4", count: 10},     // the basmala: in 1:1, 2:1, 3:1 ... (not in sura 9)
        {key: "1.2.4.4", count: 7},      // 1:2 "al-hamdu lillahi rabbi l-ʿalamin"
        {key: "2.156.9.5", count: 3},    // 2:156
    ];
    const select = range => filterQuotationsByRange(quotations, repeatedNgramsD, qTokenIndexD, range[0], range[1]);
    assert.deepStrictEqual(select(ranges.verses["2.1"]).map(q => [q.key, q.appearances.map(a => a.location)]),
                           [["1.1.4.4", ["2.1.4"]]]);
    assert.deepStrictEqual(select(ranges.suras["1"]).map(q => q.key), ["1.1.4.4", "1.2.4.4"]);
    assert.deepStrictEqual(select(ranges.suras["2"]).map(q => q.key), ["1.1.4.4", "2.156.9.5"]);
    assert.deepStrictEqual(select(ranges.suras["9"]).map(q => q.key), []);      // there is no basmala in sura 9
    // the counts and the order do not change:
    assert.deepStrictEqual(select(ranges.suras["2"]).map(q => q.count), [10, 3]);
});

test("a quotation of several verses occurs in each of its verses", () => {
    const ranges = buildRanges(qTokensD);
    // the 8 words from the middle of 1:1 to the start of 1:2 (1:1 has 4 words):
    const key = quotationKey(qTokensD, 2, 5);
    const quotations = [{key, count: 1}];
    for (const verse of ["1.1", "1.2"]) {
        const found = filterQuotationsByRange(quotations, repeatedNgramsD, qTokenIndexD, ...ranges.verses[verse]);
        assert.strictEqual(found.length, 1, verse);
    }
    assert.strictEqual(filterQuotationsByRange(quotations, repeatedNgramsD, qTokenIndexD, ...ranges.verses["1.3"]).length, 0);
});

test("selecting the quotations of a sura or verse (the data of the app)", () => {
    const rows = readNgrams();
    const merged = mergeQuotations(rows, qTokensD, repeatedLookupD);
    const ranges = buildRanges(qTokensD);
    const total = merged.reduce((sum, q) => sum + q.count, 0);

    // the quotations of sura 2:
    const sura2 = filterQuotationsByRange(merged, repeatedNgramsD, qTokenIndexD, ...ranges.suras["2"]);
    assert.ok(sura2.length > 1000 && sura2.length < merged.length);
    assert.ok(sura2.reduce((sum, q) => sum + q.count, 0) < total);
    for (const q of sura2.slice(0, 200)) {
        const original = merged.find(m => m.key === q.key);
        assert.strictEqual(q.count, original.count);
        for (const a of q.appearances) {
            assert.ok(a.end >= ranges.suras["2"][0] && a.start <= ranges.suras["2"][1], q.key);
        }
    }
    // the order (by frequency) is kept:
    for (let i = 1; i < sura2.length; i++) {
        assert.ok(sura2[i - 1].count >= sura2[i].count);
    }
    // the basmala is one of the quotations of sura 2 (it occurs at its start), and 2:156 is its most frequent verse:
    assert.strictEqual(sura2[0].key, "1.1.4.4");
    assert.deepStrictEqual(sura2[0].appearances.map(a => a.location), ["2.1.4"]);
    assert.strictEqual(sura2[1].key.slice(0, 5), "2.156");

    // the quotations of verse 2:255 (ayat al-kursi): all of them have an appearance in that verse
    const verse = filterQuotationsByRange(merged, repeatedNgramsD, qTokenIndexD, ...ranges.verses["2.255"]);
    assert.ok(verse.length > 100 && verse.length < sura2.length);
    for (const q of verse.slice(0, 100)) {
        assert.ok(q.appearances.every(a => a.end >= ranges.verses["2.255"][0] && a.start <= ranges.verses["2.255"][1]));
    }
});

test("the quotations that contain a word of a verse (a small example)", () => {
    // verse of 5 words; ngram_length is the number of words; qstart and qend: the whole quotation
    const row = (start, length, text_id, year, qstart, qend) =>
        ({ngram_start: start, ngram_length: length, text_id, year, century: Math.ceil(year / 100), qstart, qend});
    const rows = [
        row(1, 4, "7", 458, 10, 13),
        row(1, 4, "7", 458, 10, 13),     // the same text cites it again
        row(1, 4, "9", 300, 10, 13),
        row(1, 4, "5", 500, 10, 14),     // the same words of this verse, but the quotation continues in the next verse
        row(1, 5, "8", 900, 10, 14),
        row(5, 1, "8", 900, 14, 14),
        row(-2, 4, "3", 1000, 7, 10),    // starts in the previous verse: word 1 of this verse is the last word
    ];
    assert.deepStrictEqual(quotationsAtWord(rows, 1, 0),
        [{qstart: 10, qend: 13, length: 4, count: 3, nTexts: 2},
         {qstart: 10, qend: 14, length: 5, count: 2, nTexts: 2},
         {qstart: 7, qend: 10, length: 4, count: 1, nTexts: 1}]);
    assert.deepStrictEqual(quotationsAtWord(rows, 5, 0).map(q => [q.qstart, q.qend]), [[10, 14], [14, 14]]);
    assert.deepStrictEqual(quotationsAtWord(rows, 3, 0).map(q => [q.qstart, q.qend]), [[10, 13], [10, 14]]);
    // the old data (ngram_length is the number of words minus one):
    const old = rows.map(d => ({...d, ngram_length: d.ngram_length - 1}));
    assert.deepStrictEqual(quotationsAtWord(old, 1, 1), quotationsAtWord(rows, 1, 0));
    assert.deepStrictEqual(quotationsAtWord([], 1, 0), []);
});

test("the texts of a quotation of a verse (a small example)", () => {
    const rows = [
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5, qstart: 10, qend: 13},
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5, qstart: 10, qend: 13},
        {ngram_start: 1, ngram_length: 4, text_id: "9", year: 300, century: 3, qstart: 10, qend: 13},
        {ngram_start: 1, ngram_length: 4, text_id: "6", year: 600, century: 6, qstart: 10, qend: 14},
    ];
    assert.deepStrictEqual(textsOfQuotation(rows, 10, 13),
        [{textId: "9", year: 300, century: 3, count: 1}, {textId: "7", year: 458, century: 5, count: 2}]);
    assert.deepStrictEqual(textsOfQuotation(rows, 10, 14).map(t => t.textId), ["6"]);
    assert.deepStrictEqual(textsOfQuotation(rows, 11, 13), []);
});

// the verse files of the app, for the tests of the whole quotations:
const readVerseFile = name => fs.readFileSync(path.join(__dirname, "..", "data", `${name}.csv`), "utf-8")
    .split(/\r?\n/).filter(Boolean).slice(1).map(l => {
        const p = l.split(",");
        return {ngram_start: +p[0], ngram_length: +p[1], text_id: p[2], century: +p[3], year: +p[4],
                text_tok_start: p[5], text_tok_end: p[6]};
    });
const verseList = Object.keys(ayaTextD);
const deps = {
    loadRows: async v => readVerseFile(v),
    neighbour: (v, dir) => verseList[verseList.indexOf(v) + dir] || null,
    nWords: v => ayaTextD[v].split(" ").length,
    firstToken: v => qTokenIndexD[`${v}.1`],
    lengthOffset: 0,
};

test("whole quotations: a quotation of two verses (1:1 and 1:2)", async () => {
    const rows = await resolveWholeQuotations("1.1", readVerseFile("1.1"), deps);
    // one text (1338) cites "al-rahim al-hamdu lillahi rabbi l-calamin": the last word of 1:1 and 1:2
    const row = rows.find(d => d.text_id === "1338" && d.text_tok_start === "20771" && d.text_tok_end === "20775");
    assert.strictEqual(row.ngram_length, 1);
    assert.strictEqual(row.total, 5);
    assert.strictEqual(row.qstart, qTokenIndexD["1.1.4"]);
    assert.strictEqual(row.qend, qTokenIndexD["1.2.4"]);
    // the same quotation, seen from 1:2:
    const rows2 = await resolveWholeQuotations("1.2", readVerseFile("1.2"), deps);
    const row2 = rows2.find(d => d.text_id === "1338" && d.text_tok_start === "20771" && d.text_tok_end === "20775" && d.ngram_start === 1);
    assert.deepStrictEqual([row2.qstart, row2.qend, row2.total], [row.qstart, row.qend, 5]);
    // the whole quotation is at least as long as its part in the verse, and it contains it:
    for (const d of rows.concat(rows2)) {
        assert.ok(d.total >= d.ngram_length && d.qstart <= d.qend);
    }
    // (done already: nothing changes)
    assert.strictEqual(await resolveWholeQuotations("1.1", rows, deps), rows);
});

test("whole quotations: files with quote_start and quote_end need no neighbouring files", async () => {
    const rows = [{ngram_start: 3, ngram_length: 2, text_tok_start: "20", text_tok_end: "27", quote_start: "2", quote_end: "5"}];
    const loaded = [];
    const result = await resolveWholeQuotations("1.1", rows, {loadRows: async v => { loaded.push(v); return []; }});
    assert.deepStrictEqual(loaded, []);
    assert.deepStrictEqual([result[0].qstart, result[0].qend, result[0].total], [2, 5, 4]);
});

test("whole quotations: rows that are a complete quotation do not change; one-word fragments are found", async () => {
    const rows = await resolveWholeQuotations("1.1", readVerseFile("1.1"), deps);
    const whole = rows.filter(d => d.ngram_start === 1 && d.ngram_length === 4 && (+d.text_tok_end) - (+d.text_tok_start) + 1 === 4);
    assert.ok(whole.length > 30000);
    assert.ok(whole.every(d => d.total === 4 && d.qstart === 0 && d.qend === 3));
    // the one-word rows of 1:1 are the end of longer quotations:
    const oneWord = rows.filter(d => d.ngram_length === 1);
    assert.ok(oneWord.length > 0 && oneWord.filter(d => d.total > 1).length >= oneWord.length - 3);
    // the grouping of the quotations of the last word: the fragments are grouped by whole quotation:
    const quotations = quotationsAtWord(rows, 4, 0);
    assert.ok(quotations.every(q => q.length >= 1));
    assert.ok(quotations.filter(q => q.length === 1).length <= 3);
});

test("whole quotations: a small example with a quotation of three verses", async () => {
    // verses a (3 words), b (2 words), c (4 words); the quotation cites the last word of a, all of b and the first word of c
    const words = {a: 3, b: 2, c: 4};
    const files = {
        a: [{ngram_start: 3, ngram_length: 1, text_id: "1", text_tok_start: "100", text_tok_end: "103"}],
        b: [{ngram_start: 1, ngram_length: 2, text_id: "1", text_tok_start: "100", text_tok_end: "103"}],
        c: [{ngram_start: 1, ngram_length: 1, text_id: "1", text_tok_start: "100", text_tok_end: "103"}],
    };
    const order = ["a", "b", "c"];
    const d = {
        loadRows: async v => files[v],
        neighbour: (v, dir) => order[order.indexOf(v) + dir] || null,
        nWords: v => words[v],
        firstToken: v => ({a: 0, b: 3, c: 5})[v],
        lengthOffset: 0,
    };
    for (const v of order) {
        const rows = JSON.parse(JSON.stringify(files[v]));
        await resolveWholeQuotations(v, rows, d);
        assert.deepStrictEqual([rows[0].qstart, rows[0].qend, rows[0].total], [2, 5, 4], v);
    }
});

test("whole quotations: a repeated phrase in a verse that does not continue", async () => {
    // the text cites 5 words, but the row has 1 word in a verse of which the neighbours do not have the citation
    const words = {a: 3, b: 2};
    const files = {
        a: [{ngram_start: 3, ngram_length: 1, text_id: "1", text_tok_start: "100", text_tok_end: "104"}],
        b: [{ngram_start: 1, ngram_length: 2, text_id: "2", text_tok_start: "5", text_tok_end: "6"}],
    };
    const d = {loadRows: async v => files[v], neighbour: (v, dir) => ({a: {"1": "b"}, b: {"-1": "a"}})[v][dir] || null,
               nWords: v => words[v], firstToken: v => ({a: 0, b: 3})[v], lengthOffset: 0};
    const rows = JSON.parse(JSON.stringify(files.a));
    await resolveWholeQuotations("a", rows, d);
    assert.deepStrictEqual([rows[0].qstart, rows[0].qend, rows[0].total], [2, 2, 1]);
});

test("the quotations and texts of a word in a verse file of the app (33:33)", async () => {
    const rows = await resolveWholeQuotations("33.33", readVerseFile("33.33"), deps);
    const nWords = ayaTextD["33.33"].split(" ").length;
    // the number of rows that cover a word is the sum of the counts of the quotations of the word:
    const counts = tokenCounts(rows, nWords, 0);
    for (const word of [1, 10, nWords]) {
        const quotations = quotationsAtWord(rows, word, 0);
        assert.strictEqual(quotations.reduce((sum, q) => sum + q.count, 0), counts[word - 1], `word ${word}`);
        // and the texts of each quotation add up to its count:
        for (const q of quotations.slice(0, 5)) {
            const texts = textsOfQuotation(rows, q.qstart, q.qend);
            assert.strictEqual(texts.reduce((sum, t) => sum + t.count, 0), q.count);
            assert.strictEqual(texts.length, q.nTexts);
            for (let i = 1; i < texts.length; i++) assert.ok(texts[i - 1].year <= texts[i].year);
        }
        for (let i = 1; i < quotations.length; i++) assert.ok(quotations[i - 1].count >= quotations[i].count);
    }
});

test("counting the quotations per verse: first locations and all locations", () => {
    const verseList = Object.keys(ayaTextD);
    const verseOfToken = [];
    verseList.forEach((v, i) => ayaTextD[v].split(" ").forEach(() => verseOfToken.push(i)));
    const rows = readNgrams();
    const suraTotals = counts => {
        const totals = {};
        for (const [id, count] of counts) {
            const sura = verseList[id % 10000].split(".")[0];
            totals[sura] = (totals[sura] || 0) + count;
        }
        return totals;
    };
    const first = suraTotals(countByVerse(rows, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, false));
    const all = suraTotals(countByVerse(rows, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, true));
    // the first locations are the numbers in the stats file that the graphs are made from:
    const stats = {};
    for (const line of fs.readFileSync(path.join(__dirname, "..", "data", `@quran_data_stats_all_${release}.tsv`), "utf-8").split(/\r?\n/).slice(1)) {
        const p = line.split("\t");
        if (p.length === 5) stats[p[2]] = (stats[p[2]] || 0) + +p[4];
    }
    for (const sura of ["1", "2", "9", "36", "114"]) {
        assert.strictEqual(first[sura], stats[sura], `sura ${sura}`);
    }
    // all locations: never fewer, and more in suras that contain repeated quotations:
    for (const sura of Object.keys(first)) {
        assert.ok(all[sura] >= first[sura], sura);
    }
    assert.ok(all["114"] > first["114"]);
    assert.ok(all["2"] > first["2"]);
});

test("counting the quotations per verse (a small example)", () => {
    // verses a (3 words: tokens 0-2) and b (3 words: tokens 3-5); the quotation of tokens 1-2 also occurs at tokens 4-5
    const toks = {0: ["a1", "a.1"], 1: ["a2", "a.2"], 2: ["a3", "a.3"], 3: ["b1", "b.1"], 4: ["b2", "b.2"], 5: ["b3", "b.3"]};
    const index = {"a.1": 0, "a.2": 1, "a.3": 2, "b.1": 3, "b.2": 4, "b.3": 5};
    const verseOfToken = [0, 0, 0, 1, 1, 1];
    const rows = [{start_token: 1, end_token: 2, year: 100, count: 4}, {start_token: 2, end_token: 3, year: 200, count: 1}];
    const repeated = {"a.3.2": ["b.3"]};     // the quotation that ends at a.3 (2 words) also ends at b.3
    const first = countByVerse(rows, toks, index, repeated, verseOfToken, false);
    assert.deepStrictEqual(Array.from(first), [[100 * 10000, 4], [200 * 10000, 1], [200 * 10000 + 1, 1]]);
    const all = countByVerse(rows, toks, index, repeated, verseOfToken, true);
    // the first quotation: also in verse b (tokens 4-5); the second one (tokens 2-3 over two verses) is not repeated:
    assert.deepStrictEqual(Array.from(all), [[100 * 10000, 4], [100 * 10000 + 1, 4], [200 * 10000, 1], [200 * 10000 + 1, 1]]);
});

test("counting the quotations per verse: the words that an ellipsis only indicates can be left out", () => {
    // verses a, b, c of 3 words each (tokens 0-2, 3-5, 6-8)
    const toks = {}, index = {};
    for (let i = 0; i < 9; i++) { const v = "abc"[Math.floor(i / 3)]; toks[i] = [`w${i}`, `${v}.${i % 3 + 1}`]; index[`${v}.${i % 3 + 1}`] = i; }
    const verseOfToken = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    // the whole quotation: tokens 1-8; the words 2-6 (the rest of a, all of b, the start of c) are only indicated
    const rows = [{start_token: 1, end_token: 8, year: 100, count: 2, implicit: "2-6"}];
    assert.deepStrictEqual(Array.from(countByVerse(rows, toks, index, {}, verseOfToken, false)),
                           [[100 * 10000, 2], [100 * 10000 + 1, 2], [100 * 10000 + 2, 2]]);
    // the cited words are 1 (in a) and 7-8 (in c): b is not counted
    assert.deepStrictEqual(Array.from(countByVerse(rows, toks, index, {}, verseOfToken, false, null, true)),
                           [[100 * 10000, 2], [100 * 10000 + 2, 2]]);
    // a quotation with the cited words in one verse is counted once in the verse:
    const inOne = [{start_token: 0, end_token: 2, year: 100, count: 1, implicit: "1-1"}];
    assert.deepStrictEqual(Array.from(countByVerse(inOne, toks, index, {}, verseOfToken, false, null, true)), [[100 * 10000, 1]]);
    // the other location of a repeated quotation (the implicit words move with it)
    const repeated = {"a.3.3": ["c.3"]};    // the quotation of 3 words that ends at a.3 also ends at c.3
    assert.deepStrictEqual(Array.from(countByVerse(inOne, toks, index, repeated, verseOfToken, true, null, true)),
                           [[100 * 10000, 1], [100 * 10000 + 2, 1]]);
    assert.strictEqual(parseImplicit(""), null);
    assert.deepStrictEqual(parseImplicit("3-5;9-9"), [[3, 5], [9, 9]]);
    assert.deepStrictEqual(citedPieces(1, 8, [[2, 6]]), [[1, 1], [7, 8]]);
    assert.deepStrictEqual(citedPieces(1, 8, [[0, 3], [6, 9]]), [[4, 5]]);
    assert.deepStrictEqual(citedPieces(1, 3, [[1, 3]]), []);
});

test("normalising Arabic for the search", () => {
    assert.strictEqual(normaliseArabic("ٱلْمُسْتَقِيمَ"), "المستقيم");
    assert.strictEqual(normaliseArabic("الرَّحْمَٰنِ"), "الرحمن");
    assert.strictEqual(normaliseArabic("أَنزَلَ إِلَيْكَ"), "انزل اليك");
    assert.strictEqual(normaliseArabic("هُدًى"), "هدي");
    assert.strictEqual(normaliseArabic("المستقيم"), "المستقيم");
});

test("searching in the text of the Qurʾān", () => {
    const tokens = Object.keys(qTokensD).map(i => normaliseArabic(qTokensD[i][0]));
    const search = buildSearch("المستقيم", tokens);
    assert.ok(search.occurrences.length >= 3 && search.occurrences.length <= 10);   // (with the article: 5 times)
    // 1:6 "ihdina l-sirata l-mustaqim": the last word of the verse (3 words)
    const end16 = qTokenIndexD["1.6.3"];
    assert.ok(search.occurrences.some(o => o.first === end16 && o.last === end16));
    // a quotation contains the term if it contains the word:
    assert.ok(search.contains(end16 - 2, end16));
    assert.ok(search.contains(end16, end16));
    assert.ok(!search.contains(end16 - 3, end16 - 1));
    // two words: only if the quotation contains both:
    const two = buildSearch("الصراط المستقيم", tokens);
    assert.ok(two.occurrences.length >= 2 && two.occurrences.length <= search.occurrences.length);
    assert.ok(two.occurrences.every(o => o.last === o.first + 1));
    assert.ok(two.contains(end16 - 1, end16) && !two.contains(end16, end16));
    // a part of a word is found, a term that does not occur is not:
    assert.ok(buildSearch("ستقيم", tokens).occurrences.length > 30);   // (also مستقيم without the article, استقيموا ...)
    assert.strictEqual(buildSearch("ضضضضض", tokens).occurrences.length, 0);
    assert.ok(!buildSearch("ضضضضض", tokens).contains(0, 100));
    // no term: every quotation:
    assert.ok(buildSearch("", tokens).contains(5, 6));
});

test("counting the quotations per verse with a search term: only in the verses that contain the term", () => {
    const verseList = Object.keys(ayaTextD);
    const verseOfToken = [];
    verseList.forEach((v, i) => ayaTextD[v].split(" ").forEach(() => verseOfToken.push(i)));
    const tokens = Object.keys(qTokensD).map(i => normaliseArabic(qTokensD[i][0]));
    const search = buildSearch("المستقيم", tokens);
    const rows = readNgrams().filter(d => search.contains(d.start_token, d.end_token));
    for (const allLocations of [false, true]) {
        const counts = countByVerse(rows, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, allLocations, search);
        const verses = new Set(Array.from(counts.keys(), id => verseList[id % 10000]));
        const verseOfOccurrences = new Set(search.occurrences.map(o => verseList[verseOfToken[o.first]]));
        // (every verse that gets a count contains the term)
        for (const v of verses) assert.ok(verseOfOccurrences.has(v), `${v} ${allLocations}`);
        assert.ok(verses.has("1.6"));
        assert.ok(!verses.has("1.5") && !verses.has("1.7"));
        // without the search term (the whole quotation) the neighbouring verses are counted too:
        const whole = countByVerse(rows, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, allLocations);
        const wholeVerses = new Set(Array.from(whole.keys(), id => verseList[id % 10000]));
        assert.ok(wholeVerses.has("1.5") && wholeVerses.has("1.7"));
    }
    // the occurrences in a part of the Qurʾān:
    const end16 = qTokenIndexD["1.6.3"];
    assert.deepStrictEqual(search.occurrencesIn(end16 - 2, end16), [{first: end16, last: end16}]);
    assert.deepStrictEqual(search.occurrencesIn(end16 - 3, end16 - 1), []);
});

test("excluding frequent quotations", () => {
    const rows = readNgrams();
    const top = mergeQuotations(rows, qTokensD, repeatedLookupD).slice(0, 100);
    assert.strictEqual(top.length, 100);
    assert.strictEqual(top[0].key, "1.1.4.4");           // the basmala is the most frequent quotation
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].count >= top[i].count);
    const excluded = new Set(top.map(q => q.key));
    // the basmala at its first location and at another location (2:1) is excluded:
    assert.ok(isExcludedQuotation(excluded, qTokensD, repeatedLookupD, 0, 3));
    assert.ok(isExcludedQuotation(excluded, qTokensD, repeatedLookupD, qTokenIndexD["2.1.1"], qTokenIndexD["2.1.4"]));
    // a longer quotation that contains the basmala, and a shorter part of it, are other quotations:
    assert.ok(!isExcludedQuotation(excluded, qTokensD, repeatedLookupD, 0, 4));
    assert.ok(!isExcludedQuotation(excluded, qTokensD, repeatedLookupD, 1, 3));
    // nothing is excluded without excluded quotations:
    assert.ok(!isExcludedQuotation(new Set(), qTokensD, repeatedLookupD, 0, 3));
    // the rows that are left: fewer citations than before
    const kept = rows.filter(d => !isExcludedQuotation(excluded, qTokensD, repeatedLookupD, d.start_token, d.end_token));
    const total = rows.reduce((sum, d) => sum + d.count, 0);
    const keptTotal = kept.reduce((sum, d) => sum + d.count, 0);
    assert.ok(keptTotal < total && keptTotal > total * 0.5);
});


// the citation in its context: the milestones of the i.mech-20 repository
// (a test text of 650 words: the word w<number> is token <number>; milestones of 300 words; "(@)" is a newline)
const fakeWord = i => "كلمة" + "ابجدهوزحطي"[i % 10].repeat(1 + Math.floor(i / 10) % 3) + "ن".repeat(1 + Math.floor(i / 30) % 7);
const fakeTokens = Array.from({length: 650}, (_, i) => fakeWord(i));
const fakeMilestones = new Map();
for (let ms = 1; ms <= 3; ms++) {
    const words = fakeTokens.slice((ms - 1) * 300, ms * 300);
    fakeMilestones.set(ms, "(@)(@@) " + words.slice(0, 100).join(" ") + "(@)" + words.slice(100).join(" ") + " ");
}
const fakeFile = "ms1\t" + fakeMilestones.get(1) + "\nms2\t" + fakeMilestones.get(2) + "\nms3\t" + fakeMilestones.get(3) + "\n";

test("the milestone and the file of a token", () => {
    assert.deepStrictEqual([0, 299, 300, 5999, 6000].map(milestoneOfToken), [1, 1, 2, 20, 21]);
    assert.deepStrictEqual([1, 20, 21, 40, 41].map(milestoneFileNumber), [20, 20, 40, 40, 60]);
    assert.strictEqual(milestoneFileUrl("2023_1_8", "JK000698-ara1.completed", 21),
        "https://raw.githubusercontent.com/OpenITI/i.mech-20/v2023.1.8/data/JK000698-ara1.completed-00040");
    assert.strictEqual(textIdOfUri("0458Bayhaqi.Ictiqad.JK000698-ara1.completed"), "JK000698-ara1.completed");
    assert.strictEqual(textIdOfUri("0505Ghazali.IhyaCulumDin.JK000001-ara1"), "JK000001-ara1");
});

test("a milestone file is parsed and cleaned", () => {
    const milestones = parseMilestoneFile(fakeFile);
    assert.deepStrictEqual(Array.from(milestones.keys()), [1, 2, 3]);
    assert.strictEqual(milestones.get(2), fakeMilestones.get(2));
    assert.strictEqual(cleanMilestoneText("(@)(@@) a b(@)(@@) c(@)"), "\na b\nc\n");
    assert.strictEqual(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
});

test("the context of a citation inside a milestone and across milestones", () => {
    const milestones = parseMilestoneFile(fakeFile);
    let c = contextAround(milestones, 50, 53, 5, 3);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(50, 54));
    assert.strictEqual(c.quote, fakeTokens.slice(50, 54).join(" "));
    assert.strictEqual(c.before.trim(), fakeTokens.slice(45, 50).join(" "));
    assert.strictEqual(c.after.trim(), fakeTokens.slice(54, 57).join(" "));
    // a citation across the border of two milestones, with context in both:
    c = contextAround(milestones, 298, 301, 4, 4);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(298, 302));
    assert.strictEqual(c.before.replace(/\s+/g, " ").trim(), fakeTokens.slice(294, 298).join(" "));
    assert.strictEqual(c.after.replace(/\s+/g, " ").trim(), fakeTokens.slice(302, 306).join(" "));
    // the start and the end of the text: less context
    c = contextAround(milestones, 2, 3, 10, 2);
    assert.strictEqual(c.before.trim(), fakeTokens.slice(0, 2).join(" "));
    c = contextAround(milestones, 648, 649, 2, 10);
    assert.strictEqual(c.after.trim(), "");
});

test("a citation that is not in the milestones", () => {
    const milestones = parseMilestoneFile(fakeFile);
    assert.strictEqual(contextAround(milestones, 1000, 1002, 5, 5), null);
});

test("a milestone with fewer or more words than 300 displaces the citation: it is found by the words of the Qurʾān", () => {
    // milestones that are cut after the given numbers of words (as in the i.mech-20 repository: some have 299 or 301)
    const cut = sizes => {
        const milestones = new Map();
        let start = 0;
        sizes.forEach((size, i) => {
            milestones.set(i + 1, fakeTokens.slice(start, start + size).join(" ") + " ");
            start += size;
        });
        return milestones;
    };
    const quran = fakeTokens.slice(400, 405);
    // the first milestone has one word less: the words after it are one word later than the index says
    let c = contextAround(cut([299, 300, 51]), 400, 404, 3, 3, quran);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(400, 405));
    assert.strictEqual(c.shift, 1);
    assert.ok(c.matchesQuran);
    assert.strictEqual(c.before.trim(), fakeTokens.slice(397, 400).join(" "));
    // one word more: they are one word earlier
    c = contextAround(cut([301, 300, 49]), 400, 404, 3, 3, quran);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(400, 405));
    assert.strictEqual(c.shift, -1);
    // no shift
    c = contextAround(cut([300, 300, 50]), 400, 404, 3, 3, quran);
    assert.strictEqual(c.shift, 0);
    // the words of the Qurʾān are not in the text: the index is used as it is, with a warning
    c = contextAround(cut([300, 300, 50]), 400, 404, 3, 3, ["ابتث", "ثجحخ", "دذرز"]);
    assert.strictEqual(c.shift, 0);
    assert.ok(!c.matchesQuran);
    // without the words of the Qurʾān the index is used as it is
    assert.strictEqual(contextAround(cut([299, 300, 51]), 400, 404, 3, 3).shift, 0);
});

test("the words of the Qurʾān are compared with the text (alignCitation)", () => {
    const tokens = new Map(["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ", "قال"].map((w, i) => [i + 10, w]));
    const quran = ["بِسْمِ", "ٱللَّهِ", "ٱلرَّحْمَٰنِ", "ٱلرَّحِيمِ"];
    assert.deepStrictEqual(alignCitation(tokens, 10, 13, quran), {shift: 0, matches: true});
    assert.deepStrictEqual(alignCitation(tokens, 11, 14, quran), {shift: -1, matches: true});
    assert.deepStrictEqual(alignCitation(tokens, 8, 11, quran), {shift: 2, matches: true});
    assert.deepStrictEqual(alignCitation(tokens, 10, 13, ["مالك", "يوم", "الدين"]), {shift: 0, matches: false});
});

test("loading the context: the files that are needed, and a missing file after the end of the text", async () => {
    const requested = [];
    const fetchText = async url => {
        requested.push(url);
        if (url.endsWith("-00020")) return fakeFile;
        throw new Error("404");
    };
    const c = await loadCitationContext("2023_1_8", "X-ara1", 100, 103, 20, 20, fetchText, fakeTokens.slice(100, 104));
    assert.deepStrictEqual(requested, ["https://raw.githubusercontent.com/OpenITI/i.mech-20/v2023.1.8/data/X-ara1-00020"]);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(100, 104));
    assert.ok(c.matchesQuran);
    // the context of a citation near the end of a file may be in the next file, which does not exist here:
    const end = await loadCitationContext("2023_1_8", "X-ara1", 646, 648, 5, 5000, fetchText);
    assert.strictEqual(end.quote, fakeTokens.slice(646, 649).join(" "));
    // a citation in a file that does not exist rejects:
    await assert.rejects(loadCitationContext("2023_1_8", "X-ara1", 7000, 7002, 5, 5, fetchText));
});

test("the places in a text that cite a quotation", () => {
    const rows = [
        {text_id: "7", text_tok_start: "900", text_tok_end: "903", qstart: 10, qend: 13},
        {text_id: "7", text_tok_start: "100", text_tok_end: "103", qstart: 10, qend: 13},
        {text_id: "7", text_tok_start: "100", text_tok_end: "103", qstart: 10, qend: 13},   // (the same place: once)
        {text_id: "7", text_tok_start: "500", text_tok_end: "504", qstart: 10, qend: 14},
        {text_id: "8", text_tok_start: "1", text_tok_end: "4", qstart: 10, qend: 13},
    ];
    assert.deepStrictEqual(citationsOfText(rows, 10, 13, "7"), [{start: 100, end: 103}, {start: 900, end: 903}]);
    assert.deepStrictEqual(citationsOfText(rows, 10, 13, "9"), []);
});

// the exact milestone borders (the shifts of @milestone_borders_<release>.json, made by quran-tag/helpers/milestone_borders.py)
test("the exact milestone of a token, with the shifts of the text", () => {
    assert.strictEqual(borderShift(1, []), 0);
    assert.strictEqual(borderShift(2, [[3, -1], [5, 0]]), 0);
    assert.strictEqual(borderShift(3, [[3, -1], [5, 0]]), -1);
    assert.strictEqual(borderShift(4, [[3, -1], [5, 0]]), -1);
    assert.strictEqual(borderShift(5, [[3, -1], [5, 0]]), 0);
    assert.strictEqual(milestoneStart(3, [[3, -1]]), 599);
    // without shifts it is the estimate
    for (const t of [0, 299, 300, 5999, 6000]) {
        assert.strictEqual(exactMilestoneOfToken(t, []), milestoneOfToken(t));
    }
    // every token of random texts (the milestones have 298-302 tokens), compared with the lengths of the milestones:
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 30; n++) {
        const counts = Array.from({length: 1 + Math.floor(rnd() * 40)}, () => [300, 300, 300, 300, 299, 301, 302, 298][Math.floor(rnd() * 8)]);
        const starts = [0];
        counts.forEach(c => starts.push(starts[starts.length - 1] + c));
        // the shifts, as the Python script makes them (the end of the text is added if the last milestone is longer than 300):
        const shifts = [];
        let previous = 0;
        starts.forEach((start, i) => {
            if (i === starts.length - 1 && start - starts[i - 1] <= 300) return;
            const shift = start - 300 * i;
            if (shift !== previous) {
                shifts.push([i + 1, shift]);
                previous = shift;
            }
        });
        counts.forEach((count, i) => {
            for (let k = 0; k < count; k++) {
                assert.strictEqual(exactMilestoneOfToken(starts[i] + k, shifts), i + 1, `${counts} ${i + 1} ${k}`);
            }
            assert.strictEqual(milestoneStart(i + 1, shifts), starts[i]);
        });
    }
});

test("the context of a citation with the shifts of the text: the exact place, without searching", async () => {
    const cut = sizes => {
        const milestones = new Map();
        let start = 0;
        sizes.forEach((size, i) => {
            milestones.set(i + 1, fakeTokens.slice(start, start + size).join(" ") + " ");
            start += size;
        });
        return milestones;
    };
    const shifts = [[2, -1], [3, 0]];     // the first milestone has 299 words, the second 301
    const milestones = cut([299, 301, 50]);
    const quran = fakeTokens.slice(400, 405);
    let c = contextAround(milestones, 400, 404, 3, 3, quran, shifts);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(400, 405));
    assert.strictEqual(c.shift, 0);
    assert.ok(c.matchesQuran);
    assert.strictEqual(c.before.trim(), fakeTokens.slice(397, 400).join(" "));
    assert.strictEqual(c.after.trim(), fakeTokens.slice(405, 408).join(" "));
    // a citation in the milestone that is longer than 300 words, at its end:
    c = contextAround(milestones, 598, 599, 2, 2, fakeTokens.slice(598, 600), shifts);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(598, 600));
    assert.ok(c.matchesQuran);
    // the words of the Qurʾān are not in the citation (the milestones are not those of the text): a warning
    c = contextAround(milestones, 400, 404, 3, 3, ["ابتث", "ثجحخ", "دذرز"], shifts);
    assert.strictEqual(c.shift, 0);
    assert.ok(!c.matchesQuran);
    // loading: only the files that are needed
    const requested = [];
    const fetchText = async url => {
        requested.push(url);
        return "ms1\t" + milestones.get(1) + "\nms2\t" + milestones.get(2) + "\nms3\t" + milestones.get(3) + "\n";
    };
    c = await loadCitationContext("2023_1_8", "X-ara1", 400, 404, 3, 3, fetchText, quran, shifts);
    assert.deepStrictEqual(requested, ["https://raw.githubusercontent.com/OpenITI/i.mech-20/v2023.1.8/data/X-ara1-00020"]);
    assert.deepStrictEqual(c.quoteTokens, fakeTokens.slice(400, 405));
});

test("matchesGenre: a text agrees if it has at least one of the chosen genres", () => {
    const {matchesGenre} = require("./quotations.js");
    assert.ok(matchesGenre("BH", new Set()));                      // (nothing chosen: all texts)
    assert.ok(matchesGenre("NA", new Set()));
    assert.ok(matchesGenre("BH", new Set(["H"])));
    assert.ok(matchesGenre("BH", new Set(["F", "B"])));
    assert.ok(!matchesGenre("BH", new Set(["F", "K"])));
    assert.ok(matchesGenre("FḤ", new Set(["Ḥ"])));
    assert.ok(!matchesGenre("FḤ", new Set(["H"])));               // (Ḥ is not H)
    assert.ok(matchesGenre("NA", new Set(["NA"])));
    assert.ok(!matchesGenre("NA", new Set(["F"])));
    assert.ok(!matchesGenre("F", new Set(["NA"])));
    assert.ok(matchesGenre(undefined, new Set(["NA"])));          // (data without genres)
});

test("formatContextHtml: headings, small grey page numbers, line breaks", () => {
    const {formatContextHtml} = require("./quotations.js");
    assert.strictEqual(formatContextHtml("a\nb"), "a<br>b");
    assert.strictEqual(formatContextHtml("| title"), '<b style="font-size: 1.5em">title</b>');
    assert.strictEqual(formatContextHtml(" || title"), '<b style="font-size: 1.3em">title</b>');
    assert.ok(formatContextHtml("||||||| deep").includes("font-size: 1.05em"));    // (more pipes than sizes)
    assert.ok(!formatContextHtml("a | b").includes("<b"));                          // (a pipe inside a line is no heading)
    assert.strictEqual(formatContextHtml("x PageV01P119 y"), 'x <span title="End of Volume 1 Page 119" style="font-size: 0.6em; color: #999">PageV01P119</span> y');
    assert.strictEqual(formatContextHtml("<i>"), "&lt;i&gt;");                      // (the text is escaped)
});

test("cleanMilestoneText: the tags of the Qurʾān become braces (the digits after a tag are removed)", () => {
    assert.strictEqual(cleanMilestoneText("x @QB@ a b @QE@ y @QB@12 c @QE@3 z"), "x { a b } y { c } z");
});

test("formatContextHtml: PageBegVxxPxxx and PageEndVxxPxxx are page numbers too", () => {
    const {formatContextHtml} = require("./quotations.js");
    const html = formatContextHtml("a PageBegV02P005 b PageEndV02P004 c");
    assert.ok(html.includes('<span title="Beginning of Volume 2 Page 5" style="font-size: 0.6em; color: #999">PageBegV02P005</span>'));
    assert.ok(html.includes('<span title="End of Volume 2 Page 4" style="font-size: 0.6em; color: #999">PageEndV02P004</span>'));
});
