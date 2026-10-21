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
    quotationsAtWord, textsOfQuotation} = require("./quotations.js");

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
    // verse of 5 words; ngram_length is the number of words
    const rows = [
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5},
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5},    // the same text cites it again
        {ngram_start: 1, ngram_length: 4, text_id: "9", year: 300, century: 3},
        {ngram_start: 1, ngram_length: 5, text_id: "8", year: 900, century: 9},
        {ngram_start: 5, ngram_length: 1, text_id: "8", year: 900, century: 9},
        {ngram_start: -2, ngram_length: 4, text_id: "3", year: 1000, century: 10}, // starts in the previous verse: words 1-1
    ];
    assert.deepStrictEqual(quotationsAtWord(rows, 1, 0),
        [{start: 1, length: 4, count: 3, nTexts: 2}, {start: 1, length: 5, count: 1, nTexts: 1},
         {start: -2, length: 4, count: 1, nTexts: 1}]);
    assert.deepStrictEqual(quotationsAtWord(rows, 5, 0).map(q => [q.start, q.length]), [[1, 5], [5, 1]]);
    assert.deepStrictEqual(quotationsAtWord(rows, 3, 0).map(q => [q.start, q.length]), [[1, 4], [1, 5]]);
    // the old data (ngram_length is the number of words minus one):
    const old = rows.map(d => ({...d, ngram_length: d.ngram_length - 1}));
    assert.deepStrictEqual(quotationsAtWord(old, 1, 1), quotationsAtWord(rows, 1, 0));
    assert.deepStrictEqual(quotationsAtWord([], 1, 0), []);
});

test("the texts of a quotation of a verse (a small example)", () => {
    const rows = [
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5},
        {ngram_start: 1, ngram_length: 4, text_id: "7", year: 458, century: 5},
        {ngram_start: 1, ngram_length: 4, text_id: "9", year: 300, century: 3},
        {ngram_start: 1, ngram_length: 5, text_id: "8", year: 900, century: 9},
    ];
    assert.deepStrictEqual(textsOfQuotation(rows, 1, 4, 0),
        [{textId: "9", year: 300, century: 3, count: 1}, {textId: "7", year: 458, century: 5, count: 2}]);
    assert.deepStrictEqual(textsOfQuotation(rows, 1, 5, 0).map(t => t.textId), ["8"]);
    assert.deepStrictEqual(textsOfQuotation(rows, 2, 4, 0), []);
});

test("the quotations and texts of a word in a verse file of the app (33:33)", () => {
    const lines = fs.readFileSync(path.join(__dirname, "..", "data", "33.33.csv"), "utf-8")
        .split(/\r?\n/).filter(Boolean).slice(1);
    const rows = lines.map(l => {
        const p = l.split(",");
        return {ngram_start: +p[0], ngram_length: +p[1], text_id: p[2], century: +p[3], year: +p[4]};
    });
    const nWords = ayaTextD["33.33"].split(" ").length;
    // the number of rows that cover a word is the sum of the counts of the quotations of the word:
    const counts = tokenCounts(rows, nWords, 0);
    for (const word of [1, 10, nWords]) {
        const quotations = quotationsAtWord(rows, word, 0);
        assert.strictEqual(quotations.reduce((sum, q) => sum + q.count, 0), counts[word - 1], `word ${word}`);
        // and the texts of each quotation add up to its count:
        for (const q of quotations.slice(0, 5)) {
            const texts = textsOfQuotation(rows, q.start, q.length, 0);
            assert.strictEqual(texts.reduce((sum, t) => sum + t.count, 0), q.count);
            assert.strictEqual(texts.length, q.nTexts);
            for (let i = 1; i < texts.length; i++) assert.ok(texts[i - 1].year <= texts[i].year);
        }
        for (let i = 1; i < quotations.length; i++) assert.ok(quotations[i - 1].count >= quotations[i].count);
    }
});
