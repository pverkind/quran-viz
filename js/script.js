/*
App to explore Quran reuse in the OpenITI corpus

Issues:
  * sura and aya views: each ngram that is more than once in the Quran is displayed only once
  * suspicious colour scheme for the sub-aya levels: always light in the beginning, dark at the end...
  * 
*/

// file and folder paths:
const release = "2023_1_8";
const quranTextFp = "resources/quran-simple.txt";
const dataFolder = "data";
// the names of the suras (the name of sura 1 is the first element):
const SURA_NAMES = [
    "الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف", "الأنفال",
    "التوبة", "يونس", "هود", "يوسف", "الرعد", "إبراهيم", "الحجر", "النحل",
    "الإسراء", "الكهف", "مريم", "طه", "الأنبياء", "الحج", "المؤمنون", "النور",
    "الفرقان", "الشعراء", "النمل", "القصص", "العنكبوت", "الروم", "لقمان", "السجدة",
    "الأحزاب", "سبأ", "فاطر", "يس", "الصافات", "ص", "الزمر", "غافر",
    "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية", "الأحقاف", "محمد", "الفتح",
    "الحجرات", "ق", "الذاريات", "الطور", "النجم", "القمر", "الرحمن", "الواقعة",
    "الحديد", "المجادلة", "الحشر", "الممتحنة", "الصف", "الجمعة", "المنافقون", "التغابن",
    "الطلاق", "التحريم", "الملك", "القلم", "الحاقة", "المعارج", "نوح", "الجن",
    "المزمل", "المدثر", "القيامة", "الإنسان", "المرسلات", "النبأ", "النازعات", "عبس",
    "التكوير", "الانفطار", "المطففين", "الانشقاق", "البروج", "الطارق", "الأعلى", "الغاشية",
    "الفجر", "البلد", "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق",
    "القدر", "البينة", "الزلزلة", "العاديات", "القارعة", "التكاثر", "العصر", "الهمزة",
    "الفيل", "قريش", "الماعون", "الكوثر", "الكافرون", "النصر", "المسد", "الإخلاص",
    "الفلق", "الناس",
];
const allStatsFp = `${dataFolder}/@quran_data_stats_all_${release}.tsv`;

// buttons:
const resetBtn = document.getElementById("resetFiltersBtn");
d3.select("#intro").text(`Explore verbatim citations of the Quran in the OpenITI corpus (release ${release.replaceAll("_", ".")}).`);
resetBtn.addEventListener("click", resetFilters);
d3.selectAll('input[name="plotType"]').on("change", () => updateVisuals());
d3.select("#compareCentury").on("change", () => updateVisuals());
d3.selectAll('input[name="locations"]').on("change", () => updateData());
d3.selectAll('input[name="frequent"]').on("change", frequentModeChanged);
d3.selectAll('input[name="ellipsis"]').on("change", () => updateData());
d3.select("#searchInput").on("change", applySearch);
d3.selectAll('input[name="numbers"]').on("change", () => updateVisuals());
const suraVizBtn = document.getElementById("suraVizBtn");
suraVizBtn.addEventListener("click", buildSuraLevelViz);
const ayaVizBtn = document.getElementById("ayaVizBtn");
ayaVizBtn.addEventListener("click", buildAyaLevelViz);
const tableVizBtn =  document.getElementById("tableVizBtn");
tableVizBtn.addEventListener("click", buildTableViz);

// global variables, to be filled in asynchronously:
var maxAyaY, qdata, ngrams, statsPromise;
var ayaTextD = new Object();         // sura.aya: aya text
var ayaTokenIndexD = new Object();   // sura.aya: running aya number
var qTokensD = new Object();         // token index in Quran: [token, sura.aya.ayatokindex]
var qTokenIndexD = new Object();     // sura.aya.ayatokindex: token index in Quran
var repeatedNgramsD = new Object();  // key of the first appearance of an ngram: keys of the other appearances
var repeatedLookupD = new Object();  // key of each appearance of a repeated ngram: key of its first appearance
var repeatedNgramsReady;             // promise: the repeated ngrams have been loaded
var quranRanges;                     // first and last token index of each verse and sura (see buildRanges)
var ngramsPromise;                   // promise: the quotations of @ngrams_count have been loaded
var selectionCounter = 0;            // to ignore the result of an older selection if the user has clicked again


function setupFilters() {
    d3.selectAll("#centuryInputMin, #centuryInputMax, #yearInputMin, #yearInputMax, #suraInputMin, #suraInputMax, #ayaInputMin, #ayaInputMax, #lenInputMin, #lenInputMax")
        .on("change", function() {
            console.log(this.id+" VALUE CHANGED!");
            updateVisuals();
        });
}

function resetFilters(){
    console.log("Resetting filters")
    document.getElementById("centuryInputMin").value = 1;
    document.getElementById("centuryInputMax").value = 15;
    document.getElementById("yearInputMin").value = 1;
    document.getElementById("yearInputMax").value = 1450;
    document.getElementById("suraInputMin").value = 1;
    document.getElementById("suraInputMax").value = 144;
    document.getElementById("ayaInputMin").value = 1;
    document.getElementById("ayaInputMax").value = 286;
    document.getElementById("lenInputMin").value = 1;
    document.getElementById("lenInputMax").value = 300;
    document.getElementById("searchInput").value = "";

    applySearch()   // (draws the graphs again)
}

function removeAllGraphs(){
    d3.selectAll("#plotToggle, #compareToggle, #numbersToggle, #locationsToggle").classed("disabled", tableVizBtn.checked);   // (bar plot or heat map: not for the table)
    d3.selectAll("#scatter1 svg, #scatter2 svg, .nodata").remove();
    d3.select("#ayaTextDiv").html("");
    currentAyaKey = null;
    heatmapVerse = null;
    selectedWord = null;
    verseSura = null;
    tableSelection = null;
    highlightedSura = null;
    highlightedVerse = null;
    suraLocked = false;
    heatmapLocked = false;
    selectionCounter++;   // (ignore a table that is still loading)
    d3.select("#table div").remove();
}

/* Filter rows by century, year, sura and aya.
   ignore: {sura: true, aya: true}: do not use the sura / aya filter
   (the aya filter only affects the graphs of verses: not the graph of suras, nor the quotations of a verse) */
function filterArray(data, ignore = {}) {
    if (!data) {
        return [];   // (the data is still loading)
    }
    const centuryMin = +d3.select("#centuryInputMin").property("value");
    const centuryMax = +d3.select("#centuryInputMax").property("value");
    const yearMin = +d3.select("#yearInputMin").property("value");
    const yearMax = +d3.select("#yearInputMax").property("value");
    const suraMin = +d3.select("#suraInputMin").property("value");
    const suraMax = +d3.select("#suraInputMax").property("value");
    const ayaMin = +d3.select("#ayaInputMin").property("value");
    const ayaMax = +d3.select("#ayaInputMax").property("value");
    const lenMin = +d3.select("#lenInputMin").property("value");
    const lenMax = +d3.select("#lenInputMax").property("value");

    console.log("Number of rows before filtering: "+ data.length);

    const filteredData = data.filter(d =>
        d.century >= centuryMin && d.century <= centuryMax &&
        d.year >= yearMin && d.year <= yearMax &&
        (ignore.sura || (d.sura >= suraMin && d.sura <= suraMax)) &&
        (ignore.aya || (d.aya >= ayaMin && d.aya <= ayaMax))
    );
    console.log("Number of rows after filtering: "+ filteredData.length);
    return filteredData; 
}

/* The key of the data of the graphs (see computeQdata) */
function dataKey(allLocations) {
    return `${allLocations}|${search ? search.term : ""}|${excluded.size ? excludedVersion : ""}|${ignoreImplicit()}`;
}

/* Whether the words that an ellipsis only indicates (not cited in the text) are left out of the counts */
function ignoreImplicit() {
    return document.getElementById("ignoreEllipsisBtn").checked;
}

/* Whether the graphs show the stats file (the quotations at their first location, without any other settings) */
function showsStatsFile(allLocations) {
    return !allLocations && !search && excluded.size === 0 && !ignoreImplicit();
}

/* The data of the graphs: the quotations at their first location in the Qurʾān (the stats file),
   or (if "all locations" is checked and/or there is a search term, and the data is ready) the data of computeQdata */
function currentQdata() {
    const allLocations = document.getElementById("allLocationsBtn").checked;
    if (showsStatsFile(allLocations)) {
        return qdata;
    }
    return qdataCache.get(dataKey(allLocations)) || qdata;
}

/* Count the quotations (at all their locations in the Qurʾān or only at the first location), without extra data files:
   the quotations of @ngrams_count (their first location) and the dictionary of the repeated ngrams.
   If there is a search term, only the quotations that contain the term are counted.
   Returns a promise; the rows [{century, year, sura, aya, sura_aya, count}, ...] (like the stats file) are in qdataCache */
function computeQdata(allLocations) {
    const key = dataKey(allLocations);
    const current = search;
    const excludedNow = excluded;
    const ignoreNow = ignoreImplicit();
    return Promise.all([loadNgrams(), repeatedNgramsReady]).then(([rows]) => {
        if (qdataCache.has(key)) {
            return;
        }
        let used = current ? rows.filter(d => current.contains(d.start_token, d.end_token)) : rows;
        if (excludedNow.size) {
            used = used.filter(d => !isExcludedQuotation(excludedNow, qTokensD, repeatedLookupD, d.start_token, d.end_token));
        }
        const counts = countByVerse(used, qTokensD, qTokenIndexD, repeatedNgramsD, verseOfToken, allLocations, current, ignoreNow);
        qdataCache.set(key, Array.from(counts, ([id, count]) => {
            const year = Math.floor(id / 10000);
            const sura_aya = ayaKeys[id % 10000];
            const [sura, aya] = sura_aya.split(".");
            return {century: Math.ceil(year / 100), year, sura: +sura, aya: +aya, sura_aya, count};
        }));
        while (qdataCache.size > 3) {   // (keep the data of the last settings: it is big)
            qdataCache.delete(qdataCache.keys().next().value);
        }
    });
}

/* The user has changed the first location / all locations, or the search term: get the data and draw the graphs */
function updateData() {
    const allLocations = document.getElementById("allLocationsBtn").checked;
    const status = d3.select("#locationsStatus");
    const key = dataKey(allLocations);
    if (showsStatsFile(allLocations) && !qdata) {
        status.text("Loading the data of the first locations...");
        loadStats()
            .then(() => {
                if (key === dataKey(document.getElementById("allLocationsBtn").checked)) {
                    status.text("");
                    updateVisuals();
                }
            })
            .catch(error => { console.error(error); status.text("The counts could not be loaded."); });
    } else if (showsStatsFile(allLocations) || qdataCache.has(key)) {
        status.text("");
        updateVisuals();
    } else {
        status.text(search ? "Searching..." : ((excluded.size || ignoreImplicit()) && !allLocations ? "Counting..." : "Counting at all locations..."));
        computeQdata(allLocations)
            .then(() => {
                if (key === dataKey(document.getElementById("allLocationsBtn").checked)) {   // (the user has not changed the settings again)
                    status.text("");
                    updateVisuals();
                }
            })
            .catch(error => { console.error(error); status.text("The counts could not be loaded."); });
    }
}

/* The most frequently cited quotations (merged: the same quotation in different places is one quotation):
   [{key, count}, ...], the most frequent first. Returns a promise. */
function loadFrequentList() {
    return Promise.all([loadNgrams(), repeatedNgramsReady]).then(([rows]) => {
        if (!frequentList) {
            frequentList = mergeQuotations(rows, qTokensD, repeatedLookupD).slice(0, N_FREQUENT);
            frequentChoice = new Set(frequentList.map(q => q.key));   // (all of them are excluded to begin with)
        }
        return frequentList;
    });
}

/* The user has changed the frequent quotations that are excluded: draw everything again */
function frequentChanged() {
    const exclude = document.getElementById("excludeFrequentBtn").checked;
    excluded = exclude ? new Set(frequentChoice) : new Set();
    excludedVersion++;
    d3.select("#frequentStatus").text(exclude ? `${excluded.size} excluded` : "");
    updateData();
}

/* The list of the frequent quotations with a checkbox for each of them (a checked quotation is excluded) */
function drawFrequentPanel() {
    const panel = d3.select("#frequentPanel");
    panel.html("");
    panel.append("p").attr("class", "frequent-intro")
        .text(`The ${frequentList.length} most frequently cited quotations. A checked quotation is excluded from the graphs and tables:`);
    const buttons = panel.append("p");
    const setAll = value => {
        frequentChoice = value ? new Set(frequentList.map(q => q.key)) : new Set();
        panel.selectAll("input.frequent-check").property("checked", value);
        frequentChanged();
    };
    buttons.append("button").attr("type", "button").text("check all").on("click", () => setAll(true));
    buttons.append("button").attr("type", "button").text("uncheck all").on("click", () => setAll(false));
    const table = panel.append("div").attr("class", "frequent-list").append("table").attr("dir", "rtl");
    frequentList.forEach(q => {
        const ngram = parseQuotationKey(q.key, qTokenIndexD);
        const text = quranTextFromIndices(ngram.start, ngram.end);
        const row = table.append("tr");
        row.append("td").append("input").attr("type", "checkbox").attr("class", "frequent-check")
            .property("checked", frequentChoice.has(q.key))
            .on("change", function() {
                if (this.checked) { frequentChoice.add(q.key); } else { frequentChoice.delete(q.key); }
                frequentChanged();
            });
        row.append("td").attr("title", text).text(text.length > 90 ? text.slice(0, 90) + "..." : text);
        row.append("td").attr("dir", "ltr").text(q.count);
    });
}

/* The user has chosen to include or exclude the frequent quotations */
function frequentModeChanged() {
    const exclude = document.getElementById("excludeFrequentBtn").checked;
    const panel = d3.select("#frequentPanel");
    if (!exclude) {
        panel.style("display", "none");
        frequentChanged();
        return;
    }
    d3.select("#frequentStatus").text("Loading...");
    loadFrequentList().then(() => {
        drawFrequentPanel();
        panel.style("display", null);
        frequentChanged();
    }).catch(error => { console.error(error); d3.select("#frequentStatus").text("The list could not be loaded."); });
}

/* The user has typed a search term: search it in the text of the Qurʾān */
function applySearch() {
    const term = normaliseArabic(document.getElementById("searchInput").value).replace(/\s+/g, " ").trim();
    search = term ? buildSearch(term, normTokens) : null;
    const status = d3.select("#searchStatus");
    if (!search) {
        status.text("");
    } else if (search.occurrences.length === 0) {
        status.text("not found");
    } else {
        const nVerses = new Set(search.occurrences.map(o => verseOfToken[o.first])).size;
        status.text(`${search.occurrences.length} times in ${nVerses} verses`);
    }
    updateData();
}

function updateVisuals() {
    // the verse (or its heat map, and the selected word) that is shown stays visible, with the new filters:
    const keep = {
        html: d3.select("#ayaTextDiv").html(),
        verse: currentAyaKey, heatmapVerse, selectedWord, locked: heatmapLocked, verseSura,
        highlightedSura, highlightedVerse, suraLocked, tableSelection
    };
    removeAllGraphs();
    if (keep.verse && !tableVizBtn.checked) {
        if (keep.heatmapVerse) {
            d3.select("#ayaTextDiv").html(keep.html);   // (until the heat map is drawn again)
        } else {
            showAya(keep.verse);   // (the text of the verse, with the words of the search term)
        }
        currentAyaKey = keep.verse;
        heatmapVerse = keep.heatmapVerse;
        selectedWord = keep.selectedWord;
        heatmapLocked = keep.locked;
    }
    if (!tableVizBtn.checked) {
        // the selected sura and verse stay highlighted in the graphs:
        highlightedSura = keep.highlightedSura;
        highlightedVerse = keep.highlightedVerse;
        suraLocked = keep.suraLocked;
    }

    const suraMin = +d3.select("#suraInputMin").property("value");
    const suraMax = +d3.select("#suraInputMax").property("value");

    if (suraVizBtn.checked) {
        // the graph of suras ignores the aya filter:
        createScatterPlot("#scatter1", filterArray(currentQdata(), {aya: true}), "sura", "count", "Suras", null, 400);
        // the verses of the sura that the user has selected (or of the only sura that the filter allows):
        const sura = (suraMin == suraMax) ? suraMin : keep.verseSura;
        if (sura && sura >= suraMin && sura <= suraMax) {
            verseSura = sura;
            createScatterPlot("#scatter2", filterArray(currentQdata()).filter(d => d.sura == sura), "aya", "count", "Verses", sura, 400);
        }
    } else if (ayaVizBtn.checked){
        createScatterPlot("#scatter1", filterArray(currentQdata()), "sura_aya", "count", "All Verses", null, 800);
    } else if (tableVizBtn.checked){
        buildTableViz();
    }

    if (keep.heatmapVerse && !tableVizBtn.checked) {
        showAyaHeatMap(keep.heatmapVerse);
    }
    if (keep.tableSelection && !tableVizBtn.checked) {
        showQuotationsOf(keep.tableSelection.type, keep.tableSelection.id);   // (with the new filters)
    }
}

/* Whether the search term occurs in the part of the quotation (the row of a verse file) that is in the verse */
function termInVerse(d, suraAya) {
    const nWords = ayaWords[suraAya];
    const part = segmentOf(d, nWords, NGRAM_LENGTH_OFFSET);
    const first = quranRanges.verses[suraAya][0];
    return search.occurrencesIn(first + part.first - 1, first + part.last - 1).length > 0;
}

/* Filter the rows of a verse file (the quotations of one verse): by century, year
   and the length of the whole quotation (in words) */
function filterVerseRows(rows, suraAya) {
    const lenMin = +d3.select("#lenInputMin").property("value");
    const lenMax = +d3.select("#lenInputMax").property("value");
    // (the length is the length of the whole quotation, not only of its part in this verse)
    const ignore = ignoreImplicit();
    return filterArray(rows, {sura: true, aya: true}).filter(d => d.total >= lenMin && d.total <= lenMax &&
        !(ignore && d.implicit === "1") &&   // (the words that an ellipsis only indicates)
        (!search || termInVerse(d, suraAya)) &&
        !isExcludedQuotation(excluded, qTokensD, repeatedLookupD, d.qstart, d.qend));
}



/* Draw a graph of the number of quotations of suras or verses: a lollipop plot (a bar for each sura or verse)
   or (if the "heat map" button is checked) a heat map: a column for each sura or verse, the colour is the number of citations.
   If "compare by century" is checked, the heat map has a row for each century and the bars are stacked by century.
   container: "#scatter1" or "#scatter2"
   data: the rows of the stats file (century, year, sura, aya, count), filtered
   xVar: "sura", "aya" or "sura_aya"; yVar: "count"
   title: "Suras", "Verses" (the verses of the sura) or "All Verses"; sura: the sura of "Verses" */
function createScatterPlot(container, data, xVar, yVar, title, sura, width) {
    const dataXVar = xVar;
    if (data.length === 0) {
        d3.select(container).append("p").attr("class", "nodata").text("No citations agree with the filters.");
        return;
    }
    // the position of a row of the stats file in the graph: the sura, the verse or the running verse number
    const posOfRow = r => container === "#scatter2" ? r.aya : (dataXVar === "sura_aya" ? ayaTokenIndexD[r.sura_aya] : r.sura);
    // relative numbers: the number of quotations per word of the sura or verse
    const relative = document.getElementById("relativeBtn").checked;
    const wordsAt = pos => container === "#scatter2" ? ayaWords[`${sura}.${pos}`]
                         : (dataXVar === "sura_aya" ? ayaWords[ayaKeys[pos - 1]] : suraWords[pos]);
    const valueOf = r => relative ? r.count / wordsAt(posOfRow(r)) : r.count;
    const fmt = relative ? (v => d3.format(v < 1000 ? ".3~g" : ".3~s")(v)) : (v => v);
    // format data for the scatterplot:
    const aggregatedData = d3.flatRollup(data, v => d3.sum(v, valueOf), d => d[xVar]);
    const formattedData = Array.from(aggregatedData, ([x, y]) => ({ [xVar]: x, [yVar]: y}));
    // add relevant values to the dictionary:
    if (container === "#scatter2") {
        formattedData.forEach(d => {
            d.sura=sura;
            d.sura_aya=`${sura}.${d.aya}`;
        });
    } else if (xVar == "sura_aya") {
        formattedData.forEach(d => d.running_aya_number=ayaTokenIndexD[d.sura_aya]);
        xVar = "running_aya_number";
    }

    // build the scatter plot:
    
    // (compare by century: the heat map has a row for each century, the bars are stacked by century)
    const compareByCentury = document.getElementById("compareCentury").checked;
    const heatMap = document.getElementById("heatPlotBtn").checked;
    // the centuries of the rows of a heat map or of the facets of a bar plot (without comparing: one row, one bar plot)
    const centuries = compareByCentury ? (data.length ? d3.range(d3.min(data, r => r.century), d3.max(data, r => r.century) + 1) : [1]) : [0];
    const panelHeight = 60;    // (compare by century: the height of the bar plot of a century and the space between them)
    const panelGap = 6;
    const height = heatMap ? (compareByCentury ? 400 : 70)           // (a heat map with one row is not high)
                           : (compareByCentury ? centuries.length * (panelHeight + panelGap) - panelGap : 400);
    const margin = { top: 20, right: 20, bottom: 30, left: heatMap ? 40 : 60 };   // (the bars have long numbers on the y axis)
    
    // build the plot's canvas:
    const root = d3.select(container)
        .append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom);
    const svg = root.append("g")
                .attr("transform", `translate(${margin.left},${margin.top})`);

    // a click anywhere in the graph enables hovering again (see onClick):
    root.on("click", () => {
        setLocked(false);
        hint.style("display", "none");
    });

    // a pop-up (inside the graph) with a hint, shown when the mouse is over a dot:
    const hint = svg.append("text")
        .attr("class", "hint")
        .attr("font-size", 12)
        .attr("fill", "#333")
        .style("display", "none")
        .style("pointer-events", "none")
        // (a white outline, to be able to read the text on top of the lines of the graph:)
        .style("paint-order", "stroke")
        .style("stroke", "white")
        .style("stroke-width", "4px")
        .text("Click to show the heat map of the verse");
    function showHint(cx, cy) {
        // put the hint next to the dot, within the graph:
        const left = cx > width - 230;
        hint.attr("x", left ? cx - 8 : cx + 8)
            .attr("y", cy < 25 ? cy + 20 : cy - 8)
            .attr("text-anchor", left ? "end" : "start")
            .style("display", null);
    }
    
    const isSuraPlot = (title === "Suras");

    // the first and the last position on the x axis: all suras or verses that the graph can show (also if
    // they have no quotations, for example with a search term), within the sura and aya filters:
    const [axisFirst, axisLast] = (() => {
        const input = id => +d3.select(`#${id}`).property("value");
        const inside = (first, last, min, max) => [Math.max(first, min), Math.min(last, max)];
        let range;
        if (container === "#scatter2") {
            range = inside(1, ayasInSura[sura], input("ayaInputMin"), input("ayaInputMax"));
        } else if (dataXVar === "sura_aya") {
            const [suraMin, suraMax] = inside(1, 114, input("suraInputMin"), input("suraInputMax"));
            range = [ayaTokenIndexD[`${suraMin}.1`], ayaTokenIndexD[`${suraMax}.${ayasInSura[suraMax]}`]];
        } else {
            range = inside(1, 114, input("suraInputMin"), input("suraInputMax"));
        }
        // (if the filters do not make sense: the positions of the data)
        return (range[0] <= range[1]) ? range : [d3.min(formattedData, d => d[xVar]), d3.max(formattedData, d => d[xVar])];
    })();

    const heat = heatMap;
    let x, y;               // the scales of the bars
    let position;           // [x, y] where the hint is shown: the top of a bar, or the top of a column of a heat map
    let binOf = null;       // heat map: the column of a position (sura number, verse number, running verse number)
    let columnWidth;        // heat map: the width of a column

    let barData = formattedData;     // the data of the bars (compare by century: the bars of each century)
    let yPos = d => y(d[yVar]);      // the y position of the top of a bar
    let yBase = () => y(0);          // the y position of the bottom of a bar

    if (!heat) {
        // build the x scale:
        x = d3.scaleLinear()
            .domain([axisFirst - 1, axisLast])//.nice()
            .range([0, width]);

        // make sure X axis ticks are only integers:
        const xAxisTicks = x.ticks()
            .filter(tick => Number.isInteger(tick));
        svg.append("g")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x)
              .tickValues(xAxisTicks)
              .tickFormat(d3.format('d'))
            );

        if (!compareByCentury) {
            y = d3.scaleLinear()
                .domain([0, d3.max(formattedData, d => d[yVar])])//.nice()
                .range([height, 0]);
            svg.append("g")
                .call(d3.axisLeft(y));

            // the vertical lines of the lollipops:
            svg.selectAll("myline")
                .data(formattedData)
                .enter()
                .append("line")
                  .attr("x1", d => x(d[xVar]))
                  .attr("x2", d => x(d[xVar]))
                  .attr("y1", d => y(d[yVar]))
                  .attr("y2", y(0))
                  .attr("stroke", "blue")
        } else {
            // a bar plot for each century, above each other (the same y scale: the plots can be compared)
            const byCentury = d3.rollup(data, v => d3.sum(v, valueOf), r => r.century, posOfRow);
            const maxCount = d3.max(Array.from(byCentury.values(), m => d3.max(m.values()))) || 1;
            y = d3.scaleLinear().domain([0, maxCount]).range([panelHeight, 0]);
            const barOf = new Map(formattedData.map(d => [d[xVar], d]));
            const panelTop = i => i * (panelHeight + panelGap);
            barData = [];
            centuries.forEach((century, i) => {
                const panel = svg.append("g").attr("transform", `translate(0,${panelTop(i)})`);
                panel.append("rect").attr("width", width).attr("height", panelHeight).attr("fill", i % 2 ? "#fff" : "#f5f8fb");
                panel.append("g").call(d3.axisLeft(y).ticks(3).tickFormat(relative ? fmt : d3.format("~s")));
                panel.append("text").attr("x", 4).attr("y", 11).attr("font-size", 10).attr("fill", "#555").text(`century ${century}`);
                for (const [pos, count] of byCentury.get(century) || []) {
                    barData.push({...barOf.get(pos), [yVar]: count, panel: i, century});
                    panel.append("line")
                        .attr("x1", x(pos)).attr("x2", x(pos))
                        .attr("y1", y(count)).attr("y2", y(0))
                        .attr("stroke", "blue");
                }
            });
            yPos = d => panelTop(d.panel) + y(d[yVar]);
            yBase = d => panelTop(d.panel) + y(0);
        }
        // the label of the y axis:
        svg.append("text").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -margin.left + 12)
            .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "#555")
            .text(relative ? "citations per word" : "citations");
        position = d => [x(d[xVar]), yPos(d)];
    } else {
        // a heat map: a column for each sura or verse (a column for several verses if there are more than pixels),
        // a row for each century, the colour is the number of quotations
        const pos0 = axisFirst;
        const pos1 = axisLast;
        const binSize = Math.max(1, Math.ceil((pos1 - pos0 + 1) / width));
        const nBins = Math.floor((pos1 - pos0) / binSize) + 1;
        columnWidth = width / nBins;
        binOf = pos => Math.floor((pos - pos0) / binSize);
        // (relative numbers: the number of words of the suras or verses of a column)
        const wordsOfColumn = b => d3.sum(d3.range(pos0 + b * binSize, Math.min(pos1, pos0 + (b + 1) * binSize - 1) + 1), wordsAt);

        // the sura or verse that represents a column: the one with the most quotations
        const reps = new Map();
        formattedData.forEach(d => {
            const b = binOf(d[xVar]);
            if (!reps.has(b) || d[yVar] > reps.get(b)[yVar]) reps.set(b, d);
        });
        const columns = Array.from(reps, ([b, d]) => ({...d, colId: b}));

        // the number of quotations per column and century:
        // (only the centuries of the filtered data: the y axis follows the century and year filters)
        // (without "compare by century" there is one row)
        const rowOf = compareByCentury ? (r => r.century) : (() => 0);
        const cells = [];
        for (const [b, byCentury] of d3.rollup(data, v => d3.sum(v, r => r.count), r => binOf(posOfRow(r)), rowOf)) {
            for (const [century, count] of byCentury) {
                cells.push({colId: b, century, count: relative ? count / wordsOfColumn(b) : count, rep: reps.get(b)});
            }
        }
        const maxCount = d3.max(cells, c => c.count) || 1;
        // (a few suras and verses have many more quotations than the rest: the colour scale is logarithmic)
        const color = d3.scaleSequentialSymlog(d3.interpolateYlOrRd).domain([0, maxCount]);

        const xs = d3.scaleLinear().domain([pos0 - 0.5, pos0 - 0.5 + nBins * binSize]).range([0, width]);
        const yb = d3.scaleBand().domain(centuries).range([0, height]);
        svg.append("g").attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(xs).tickValues(xs.ticks().filter(Number.isInteger)).tickFormat(d3.format("d")));
        if (compareByCentury) {
            svg.append("g").call(d3.axisLeft(yb));
            svg.append("text").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -30)
                .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "#555").text("century");
        }

        const label = d => {
            if (isSuraPlot) return `sura ${d.sura} ${SURA_NAMES[d.sura - 1]}`;
            return (binSize > 1 ? "verses around " : "verse ") + d.sura_aya;
        };
        svg.append("rect").attr("width", width).attr("height", height).attr("fill", "#f3f3f3");
        svg.selectAll(".cell").data(cells).enter().append("rect")
            .attr("class", "cell")
            .attr("x", c => c.colId * columnWidth)
            .attr("y", c => yb(c.century))
            .attr("width", Math.max(columnWidth, 1))
            .attr("height", yb.bandwidth())
            .attr("fill", c => color(c.count))
            .style("pointer-events", "none")
            .append("title").text(c => `${label(c.rep)}${compareByCentury ? `, century ${c.century}` : ""}: ${fmt(c.count)} ${relative ? "citations per word" : "citations"}`);

        // a legend in the top margin: the colour scale:
        const gradient = root.append("defs").append("linearGradient").attr("id", `legend-${container.slice(1)}`);
        d3.range(0, 1.01, 0.1).forEach(t => gradient.append("stop")
            .attr("offset", `${t * 100}%`).attr("stop-color", color(Math.expm1(t * Math.log1p(maxCount)))));
        const legendWidth = 70;
        svg.append("rect").attr("x", width - legendWidth - 30).attr("y", -15).attr("width", legendWidth).attr("height", 8)
            .attr("fill", `url(#legend-${container.slice(1)})`);
        svg.append("text").attr("x", width - legendWidth - 34).attr("y", -8).attr("text-anchor", "end").attr("font-size", 10).text("0");
        svg.append("text").attr("x", width - 26).attr("y", -8).attr("font-size", 10).text(fmt(maxCount));

        // the columns: invisible areas on top of the cells to hover over and click on
        svg.selectAll(".hitcol").data(columns).enter().append("rect")
            .attr("class", "hitcol")
            .attr("x", d => d.colId * columnWidth)
            .attr("y", 0)
            .attr("width", Math.max(columnWidth, 1))
            .attr("height", height)
            .style("fill", "transparent")
            .style("cursor", "pointer");
        position = d => [d.colId * columnWidth + columnWidth / 2, 12];
    }

    // The mouse handlers are shared by the dots and by the (wide, invisible) lines of the bars,
    // so that a bar can be selected by hovering over it or clicking on it, not only its top.
    // Hovering is disabled after a click on a bar (until the user clicks in the graph):
    function isLocked() { return isSuraPlot ? suraLocked : heatmapLocked; }
    function setLocked(value) { if (isSuraPlot) { suraLocked = value; } else { heatmapLocked = value; } }

    // the circle of a bar (only the circles of this graph: the other graph has its own selected bar):
    const sameBar = (e, d) => isSuraPlot ? e.sura === d.sura : e.sura_aya === d.sura_aya;
    const dotOf = d => svg.selectAll(heat ? ".hitcol" : ".dot").filter(e => heat ? e.colId === d.colId : sameBar(e, d));
    function showSelected(selection) {
        if (heat) {
            selection.style("fill", "rgba(255, 0, 0, 0.12)").style("stroke", "red");
        } else {
            selection.style("fill", "red").style("opacity", 0.5);
        }
    }
    function highlight(d) {
        if (heat) {
            svg.selectAll(".hitcol").style("fill", "transparent").style("stroke", "none");
        } else {
            svg.selectAll(".dot").style("fill", "blue").style("opacity", 0);
        }
        showSelected(dotOf(d));
        if (isSuraPlot) { highlightedSura = d.sura; } else { highlightedVerse = d.sura_aya; }
    }

    function onMouseOver(event, d) {
        if (isLocked()) {
            return;   // a bar has been clicked: hovering is disabled until the user clicks in the graph
        }
        hoverOverBar(d);
    }

    function onClick(event, d) {
        event.stopPropagation();   // (a click elsewhere in the graph enables hovering again)
        hint.style("display", "none");
        if (isLocked()) {
            // enable hovering again (and treat the click as the mouse entering this bar):
            setLocked(false);
            hoverOverBar(d);
            return;
        }
        highlight(d);
        if (title === "Suras") {
            // clicking on a sura shows its verses and the quotations of the sura in the table:
            hoverOverBar(d);
            setLocked(true);
            showQuotationsOf("sura", d.sura);
        } else {
            // clicking on a bar of a verse shows the heat map of the verse
            // and disables hovering (until the user clicks in a graph):
            setLocked(true);
            showAyaHeatMap(d.sura_aya);
            showQuotationsOf("verse", d.sura_aya);
        }
    }

    // what happens when the mouse is over a bar (or a click enables hovering again):
    function hoverOverBar(d) {
        highlight(d);
        if (title === "Suras") {
            d3.select("#ayaTextDiv").html("");
            currentAyaKey = null;
            filterScatter2(d);
        } else {
            // show the text of the verse (the heat map is shown when the bar is clicked):
            showAya(d.sura_aya);
            showHint(...position(d));
        }
    }

    if (heat) {
        svg.selectAll(".hitcol")
            .on("mouseover", onMouseOver)
            .on("mouseout", () => hint.style("display", "none"))
            .on("click", onClick);
    } else {
        // the wide, invisible lines on top of the visible lines of the bars:
        svg.selectAll(".hitline")
            .data(barData)
            .enter()
            .append("line")
                .attr("class", "hitline")
                .attr("x1", d => x(d[xVar]))
                .attr("x2", d => x(d[xVar]))
                .attr("y1", yPos)
                .attr("y2", yBase)
                .attr("stroke", "transparent")
                .attr("stroke-width", 10)
                .style("pointer-events", "stroke")
                .style("cursor", "pointer")
                .on("mouseover", onMouseOver)
                .on("mouseout", () => hint.style("display", "none"))
                .on("click", onClick);

        // then the circles:
        svg.selectAll(".dot")
            .data(barData)
            .enter()
            .append("circle")
                .attr("class", "dot")
                .attr("cx", d => x(d[xVar]))
                .attr("cy", yPos)
                .attr("r", 5)
                .style("fill", "blue")
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("mouseover", onMouseOver)
                .on("mouseout", () => hint.style("display", "none"))
                .on("click", onClick);
    }

    // the sura or verse that was selected before the graph was drawn again stays highlighted:
    const selected = isSuraPlot ? highlightedSura : highlightedVerse;
    if (selected !== null) {
        if (heat) {
            // (the column that contains the sura or verse)
            let selectedPosition = null;
            if (isSuraPlot) {
                selectedPosition = selected;
            } else if (container === "#scatter2") {
                const [selectedSura, selectedAya] = selected.split(".");
                selectedPosition = (selectedSura == sura) ? +selectedAya : null;
            } else {
                selectedPosition = ayaTokenIndexD[selected];
            }
            if (selectedPosition !== null) {
                showSelected(svg.selectAll(".hitcol").filter(d => d.colId === binOf(selectedPosition)));
            }
        } else {
            showSelected(svg.selectAll(".dot").filter(d => (isSuraPlot ? d.sura : d.sura_aya) == selected));
        }
    }

    // add the title to the graph:
    const aboveGraph = heat || compareByCentury;
    if (title == "Verses") {
        title = `Verses in sura ${sura} - ${SURA_NAMES[sura - 1]}`;
    }
    svg.append("text")
        .attr("x", aboveGraph ? 0 : width / 2)
        .attr("y", aboveGraph ? -6 : margin.top)   // (a heat map or the bar plots of the centuries cover the top of the graph: the title is above it)
        .attr("text-anchor", aboveGraph ? "start" : "middle")
        .text(relative ? `${title} (citations per word)` : title);

    // draw the hint on top of the lines and dots:
    hint.raise();
}


/* Show the verses of a sura (that the mouse is over, or that the user has clicked on) in the second graph.
   If it is another sura than the one that was shown, the aya filter is reset to all the verses of the sura. */
function filterScatter2(clickedDotD) {
    d3.selectAll("#scatter2 svg, #scatter2 .nodata").remove();   // (the graph and the message that there is no data)
    if (verseSura !== clickedDotD.sura) {
        document.getElementById("ayaInputMin").value = 1;
        document.getElementById("ayaInputMax").value = ayasInSura[clickedDotD.sura];
        verseSura = clickedDotD.sura;
        highlightedVerse = null;
    }
    const filteredData = filterArray(currentQdata()).filter(d => d.sura == clickedDotD.sura);
    createScatterPlot("#scatter2", filteredData, "aya", "count", "Verses", clickedDotD.sura, 400);
}

function buildSuraLevelViz(){
    removeAllGraphs()
    createScatterPlot("#scatter1", filterArray(currentQdata(), {aya: true}), "sura", "count", "Suras", null, 400);
}

function buildAyaLevelViz() {
    removeAllGraphs()
    createScatterPlot("#scatter1", filterArray(currentQdata()), "sura_aya", "count", "All Verses", null, 800);
}

function filterNgrams(data) {
    const centuryMin = +d3.select("#centuryInputMin").property("value");
    const centuryMax = +d3.select("#centuryInputMax").property("value");
    const yearMin = +d3.select("#yearInputMin").property("value");
    const yearMax = +d3.select("#yearInputMax").property("value");
    //const suraMin = +d3.select("#suraInputMin").property("value");
    //const suraMax = +d3.select("#suraInputMax").property("value");
    //const ayaMin = +d3.select("#ayaInputMin").property("value");
    //const ayaMax = +d3.select("#ayaInputMax").property("value");
    const lenMin = +d3.select("#lenInputMin").property("value");
    const lenMax = +d3.select("#lenInputMax").property("value");

    console.log("Number of rows before filtering: "+ data.length);

    const filteredData = data.filter(d =>
        d.century >= centuryMin && d.century <= centuryMax &&
        d.year >= yearMin && d.year <= yearMax &&
        d.len >= lenMin && d.len <= lenMax &&
        (!search || search.contains(d.start_token, d.end_token))
    );

    console.log("Number of rows after filtering: "+ filteredData.length);
    return filteredData;

}

/* The words of the search term in a part of the Qurʾān (token indexes start to end): a Set of token indexes
   (null if there is no search term) */
function searchHits(start, end) {
    if (!search) {
        return null;
    }
    const hits = new Set();
    for (const o of search.occurrencesIn(start, end)) {
        for (let i = o.first; i <= o.last; i++) hits.add(i);
    }
    return hits;
}

/* A word of a quotation as html: the words of the search term are bold and italic
   (the word that is selected in the heat map is bold only: see quotationHtml) */
function markedWord(word, isHit, isSelected) {
    let text = isHit ? `<i>${word}</i>` : word;
    return (isHit || isSelected) ? `<b>${text}</b>` : text;
}

/* The text of a quotation (token indexes start to end) as html, with the words of the search term in bold and italic */
function quotationTextHtml(start, end) {
    const hits = searchHits(start, end);
    const words = [];
    for (let i = start; i <= end; i++) {
        words.push(markedWord(qTokensD[i][0], hits && hits.has(i), false));
    }
    return words.join(" ");
}

/* The text of a verse as html, with the words of the search term in bold and italic */
function verseTextHtml(suraAya) {
    const [first, last] = quranRanges.verses[suraAya];
    return quotationTextHtml(first, last);
}

function quranTextFromIndices(start, end){
    let qstr = "";
    for (let i=start; i<end+1; i++){
        qstr += qTokensD[i][0] + " ";
    }
    return qstr.trimEnd();
}

/* The verse(s) of a quotation, as html: the first appearance of the quotation in the Qurʾān
   and the number of other verses in which it occurs.
   key: key of the first appearance of the quotation (see quotations.js) */
/* The verse(s) of an appearance of a quotation: "3.26", or "3.26-3.27" if the quotation goes beyond the verse
   a: {start, end}: the token indexes of the first and the last word in the Qurʾān (see appearancesOf) */
function verseLabel(a) {
    const first = ayaKeys[verseOfToken[a.start]];
    const last = ayaKeys[verseOfToken[a.end]];
    return first === last ? first : `${first}-${last}`;
}

/* The verses of a quotation as html (in the table of all quotations): the first appearance in the Qurʾān,
   and the number of other verses in which it occurs (with a pop-up with the list of these verses)
   key: key of the first appearance of the quotation (see quotations.js) */
function getAllSuras(key){
    const labels = [...new Set(appearancesOf(key, repeatedNgramsD, qTokenIndexD).map(verseLabel))];
    return versesHtml(labels, "other");
}

/* The first verse (with the text of the verse as a tooltip) and a small text with a pop-up with the other verses
   labels: the verses (see verseLabel); word: "other" or "more here" (see moreVersesHtml) */
function versesHtml(labels, word) {
    const first = labels[0];
    let html = `<span class="ttanchor" title="${ayaTextD[first.split("-")[0]]}">${first}</span>`;
    if (labels.length > 1) {
        html += "<br>" + moreVersesHtml(labels.slice(1), word);
    }
    return html;
}

/* "(and 3 other verses)": a small text with a pop-up with the list of the verses (when the mouse is over the text)
   verses: the verses ("<sura>.<aya>"); word: "other" or "more here" */
function moreVersesHtml(verses, word) {
    const label = `and ${verses.length} ${word === "other" ? (verses.length === 1 ? "other verse" : "other verses") : "more here"}`;
    return `<span class="more" dir="ltr">(${label})<span class="popup">${verses.join(", ")}</span></span>`;
}

/* The verses of the appearances of a quotation that are in a part of the Qurʾān (a sura or a verse), as html.
   appearances: see filterQuotationsByRange */
function getVersesInPart(appearances){
    return versesHtml([...new Set(appearances.map(verseLabel))], "more here");
}

/* Merge the rows of the same quotation at different locations in the Quran
   (e.g. the basmala at the start of sura 1 and at the start of sura 2), and sum up the counts:
   [{key: key of the first appearance of the quotation, count: count}, ...] sorted by the number of citations */
function mergeFilteredNgrams(data){
    const merged = mergeQuotations(filterNgrams(data), qTokensD, repeatedLookupD);
    return excluded.size ? merged.filter(q => !excluded.has(q.key)) : merged;   // (without the excluded quotations)
}

/* Show the top 300 quotations in the table.
   quotations: [{key, count, appearances (optional)}, ...]
   caption: html of the caption (use ${n} for the number of quotations)
   verseHtml: function that returns the html of the verse(s) of a quotation
   textHtml (optional): function that returns the html of the text of a quotation (default: the words) */
/* The text of a quotation of a sura or verse as html: the words that are not in the sura or verse are grey
   q: {key, appearances} (see filterQuotationsByRange); range: [first, last]: the first and last token index of the sura or verse */
function quotationHtmlInRange(q, range) {
    const ngram = parseQuotationKey(q.key, qTokenIndexD);
    const where = q.appearances[0];   // (the place of the quotation in the sura or verse: the words of the quotation are the same in each place)
    const hits = searchHits(ngram.start, ngram.end);
    let html = "";
    for (let i = 0; i <= ngram.end - ngram.start; i++) {
        const word = markedWord(qTokensD[ngram.start + i][0], hits && hits.has(ngram.start + i), false);
        const position = where.start + i;
        html += (position < range[0] || position > range[1]) ? `<span style="color: #999">${word}</span> ` : `${word} `;
    }
    return html.trimEnd();
}

function renderQuotationTable(quotations, caption, verseHtml, textHtml){
    // keep only the top 300 quotations
    // and convert the keys into the text of the quotation, the verse(s) and the frequency:
    const top = quotations.slice(0,300).map(q => {
        const ngram = parseQuotationKey(q.key, qTokenIndexD);
        return [verseHtml(q), textHtml ? textHtml(q) : quotationTextHtml(ngram.start, ngram.end), q.count];
    });
    // (the table is right to left: from the right, the columns are the verse, the quotation and the frequency)
    let table = '<table dir="rtl"><tr><th>Verse</th><th>Quoted Quran text</th><th>citations</th></tr>';
    top.forEach(arr => {
        table += "<tr>";
        arr.forEach(el => table += `<td>${el}</td>`);
        table += "</tr>";
    });
    table += "</table>";
    d3.select("#table").html(`<div><p>${caption.replace("${n}", quotations.length)}</p>${table}</div>`);
}

function buildTable(data){
    console.log("Filtering data for the quotation-level table")
    const merged = mergeFilteredNgrams(data);
    renderQuotationTable(merged,
        "Displaying the 300 most frequently cited quotations (out of ${n} that agree with the filters; the same quotation in different verses is counted as one):",
        q => getAllSuras(q.key));
}

/* Show the table of the quotations that occur in a sura or a verse (after a click in the sura-level or verse-level graph)
   type: "sura" or "verse"
   id: the number of the sura ("2") or the verse ("2.255") */
function showQuotationsOf(type, id){
    tableSelection = {type, id};
    const thisSelection = ++selectionCounter;
    if (type === "verse") {
        // the quotations of a verse: the same table as for a word of the heat map (with the texts that cite a quotation)
        const [sura, aya] = id.split(".");
        d3.select("#table").html(`<div><p>Loading the quotations of verse ${id}...</p></div>`);
        loadResolvedAyaData(sura, aya).then(rows => {
            if (thisSelection !== selectionCounter) {
                return;   // the user has clicked on something else in the meantime
            }
            d3.select("#table").html('<div id="verseQuotations" dir="ltr"></div>');
            showQuotationTable(id, filterVerseRows(rows, id), null, "#verseQuotations");
        }).catch(error => {
            console.error(error);
            if (thisSelection === selectionCounter) {
                d3.select("#table").html(`<div><p>The quotations of verse ${id} could not be loaded.</p></div>`);
            }
        });
        return;
    }
    const range = (type === "sura") ? quranRanges.suras[id] : quranRanges.verses[id];
    const name = (type === "sura") ? `sura ${id}` : `verse ${id}`;
    d3.select("#table").html(`<div><p>Loading the quotations of ${name}...</p></div>`);
    Promise.all([ngramsPromise || loadNgrams(), repeatedNgramsReady]).then(([data]) => {
        if (thisSelection !== selectionCounter) {
            return;   // the user has clicked on something else in the meantime
        }
        const merged = mergeFilteredNgrams(data);
        const inPart = filterQuotationsByRange(merged, repeatedNgramsD, qTokenIndexD, range[0], range[1]);
        renderQuotationTable(inPart,
            `Quotations of ${name}: displaying the 300 most frequently cited quotations (out of \${n} that agree with the filters; ` +
            `citations: the number of times the quotation is cited in the corpus, wherever it occurs in the Qurʾān; ` +
            `words in grey are outside the ${type}):`,
            q => getVersesInPart(q.appearances),
            q => quotationHtmlInRange(q, range));
    }).catch(error => {
        console.error(error);
        if (thisSelection === selectionCounter) {
            d3.select("#table").html(`<div><p>The quotations of ${name} could not be loaded.</p></div>`);
        }
    });
}

/*Display a table displaying the top X ngrams*/
function buildTableViz(){
    removeAllGraphs()
    // (the table needs the repeated ngrams to merge the same quotation at different locations)
    Promise.resolve(repeatedNgramsReady).then(() => loadNgramsAndBuildTable());
}

/* Load (once) the quotations of the whole Qurʾān (@ngrams_count) */
function loadNgrams(){
    if (!ngramsPromise) {
        const fp =  `${dataFolder}/@ngrams_count_${release}.csv`;
        ngramsPromise = d3.csv(fp).then(data => {
            data.forEach(d => {
                d.start_token = +d.start_token;
                d.end_token = +d.end_token;
                d.count = +d.count;
                d.year = +d.year;
                d.century = Math.ceil(d.year/100);
                d.len = d.end_token - d.start_token + 1;   // (the number of words)
            })
            ngrams = data;
            return data;
        });
        ngramsPromise.catch(() => { ngramsPromise = undefined; });   // (so that it can be tried again)
    }
    return ngramsPromise;
}

function loadNgramsAndBuildTable(){
    loadNgrams().then(buildTable);
}

/* The number of words that a row of a verse file (data/<sura>.<aya>.csv) covers is
   ngram_length + NGRAM_LENGTH_OFFSET. ngram_length is the number of words (data generated in 2026 or later; in older data
   it was the number of words minus one, which corresponds to an offset of 1). */
const NGRAM_LENGTH_OFFSET = 0;

var ayaDataCache = new Map();   // "sura.aya": promise of the rows of the file of that verse
var currentAyaKey = null;       // the verse that is shown below the plot
var verseOfToken = [];            // token index in the Qurʾān: index of its verse (in ayaKeys)
var qdataCache = new Map();       // like qdata, but for other settings: all locations and/or the search (see computeQdata)
var frequentList = null;          // the most frequent quotations: [{key, count}, ...] (see loadFrequentList)
var frequentChoice = new Set();   // the keys of the frequent quotations that the user has checked (to exclude)
var excluded = new Set();         // the keys of the quotations that are excluded now (frequentChoice, if "exclude" is checked)
var excludedVersion = 0;          // changes when the excluded quotations change (for the cache of the data)
const N_FREQUENT = 100;           // the number of frequent quotations in the list
var normTokens = [];              // token index in the Qurʾān: the normalised word (for the search)
var search = null;                // the search (see applySearch and buildSearch): null if there is no search term
var ayaWords = new Object();      // sura.aya: number of words of the verse
var suraWords = new Object();     // sura: number of words of the sura
var ayasInSura = new Object();  // sura: number of verses in the sura
var highlightedSura = null;     // the sura whose circle is red in the graph of suras
var highlightedVerse = null;    // the verse ("sura.aya") whose circle is red in the graph of verses
var suraLocked = false;         // True after a click on a bar of the graph of suras (hovering is disabled)
var tableSelection = null;      // {type, id} of the sura or verse of which the quotations are in the table (see showQuotationsOf)
var verseSura = null;           // the sura of which the verses are shown in the second graph (sura-level view)
var heatmapVerse = null;        // the verse of which the heat map is shown
var selectedWord = null;        // the word of that verse that the user has clicked on (number of the word in the verse)
var heatmapLocked = false;      // True after a click on a dot: hovering is disabled until the user clicks in a graph

/* Load (once) the quotations of a verse: data/<sura>.<aya>.csv */
function loadAyaData(sura, aya) {
    const key = `${sura}.${aya}`;
    if (!ayaDataCache.has(key)) {
        const promise = d3.csv(`${dataFolder}/${key}.csv`).then(rows => {
            rows.forEach(d => {
                d.ngram_start = +d.ngram_start;
                d.ngram_length = +d.ngram_length;
                d.century = +d.century;
                d.year = +d.year;
                d.sura = +sura;
                d.aya = +aya;
            });
            return rows;
        });
        promise.catch(() => ayaDataCache.delete(key));   // (so that it can be tried again)
        ayaDataCache.set(key, promise);
    }
    return ayaDataCache.get(key);
}

var ayaKeys = [];                       // all verses ("sura.aya") in the order of the Qurʾān
var resolvedAyaDataCache = new Map();   // "sura.aya": promise of the rows of the verse with the whole quotations

/* Load (once) the quotations of a verse, with the whole quotation of each row (qstart, qend, total):
   a quotation of several verses has a row in the file of each of its verses (see resolveWholeQuotations) */
function loadResolvedAyaData(sura, aya) {
    const key = `${sura}.${aya}`;
    if (!resolvedAyaDataCache.has(key)) {
        const promise = loadAyaData(sura, aya).then(rows => resolveWholeQuotations(key, rows, {
            loadRows: v => loadAyaData(...v.split(".")),
            neighbour: (v, dir) => ayaKeys[ayaTokenIndexD[v] - 1 + dir] || null,
            nWords: v => ayaTextD[v].split(" ").length,
            firstToken: v => quranRanges.verses[v][0],
            lengthOffset: NGRAM_LENGTH_OFFSET,
        }));
        promise.catch(() => resolvedAyaDataCache.delete(key));   // (so that it can be tried again)
        resolvedAyaDataCache.set(key, promise);
    }
    return resolvedAyaDataCache.get(key);
}

/* Show the text of a verse (when the mouse is over the dot at the top of its bar) */
function showAya(suraAya) {
    if (currentAyaKey === suraAya) {
        return;   // (it is shown already; this keeps the heat map if the mouse enters the same dot again)
    }
    currentAyaKey = suraAya;
    heatmapVerse = null;
    selectedWord = null;
    d3.select("#ayaTextDiv").html(
        `<p>${suraAya}: ${verseTextHtml(suraAya)}</p>` +
        `<p dir="ltr" id="heatmapStatus"></p>`);
}

/* Show the verse with each word coloured by the number of quotations that contain the word

   (Earlier observation: the last part of a verse seemed to be reused more often than the beginning.
   To be checked in the data: the cause can be the data, not the code.) */
function showAyaHeatMap(suraAya) {
    const [sura, aya] = suraAya.split(".");
    showAya(suraAya);   // (does nothing if the verse is shown already)
    d3.select("#heatmapStatus").text("Loading the heat map...");
    loadResolvedAyaData(sura, aya).then(rows => {
        if (currentAyaKey !== suraAya) {
            return;   // the mouse has moved to another verse in the meantime
        }
        const filteredRows = filterVerseRows(rows, suraAya);
        d3.select("#ayaTextDiv").html(formatAyaHeatMap(suraAya, filteredRows));
        heatmapVerse = suraAya;
        // select a word: show the quotations that contain the word
        const selectWord = word => {
            selectedWord = word;
            d3.selectAll("#ayaTextDiv span[data-word]").style("outline", null);
            d3.select(`#ayaTextDiv span[data-word="${word}"]`).style("outline", "2px solid black");
            showQuotationsOfWord(suraAya, filteredRows, word);
        };
        d3.selectAll("#ayaTextDiv span[data-word]").on("click", function() {
            selectWord(+this.dataset.word);
        });
        if (selectedWord && !d3.select("#wordDetails").empty()) {
            selectWord(selectedWord);   // (the filters have changed: the same word stays selected)
        }
    }).catch(error => {
        console.error(error);
        if (currentAyaKey === suraAya) {
            d3.select("#heatmapStatus").text("The heat map is not available (click in the graph, and then on the dot to try again).");
        }
    });
}

/* The names of the texts (version URIs of the OpenITI corpus) by the text_id of the verse files */
var textIdsPromise;
function loadTextIds() {
    if (!textIdsPromise) {
        textIdsPromise = d3.json("resources/@text_ids.json");
        textIdsPromise.catch(() => { textIdsPromise = undefined; });   // (so that it can be tried again)
    }
    return textIdsPromise;
}

/* The whole quotation (see quotationsAtWord) as html: the words that are not in the verse are grey,
   the word that the user has selected (its token index in the Qurʾān) is bold,
   the words of the search term are bold and italic */
function quotationHtml(suraAya, q, selectedToken) {
    const [first, last] = quranRanges.verses[suraAya];
    const hits = searchHits(q.qstart, q.qend);
    let html = "";
    for (let i = q.qstart; i <= q.qend; i++) {
        const text = markedWord(qTokensD[i][0], hits && hits.has(i), i === selectedToken);
        html += (i < first || i > last) ? `<span style="color: #999">${text}</span> ` : `${text} `;
    }
    return html.trimEnd();
}

/* "1 text", "2 texts" */
function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

/* Show the quotations of a verse that contain a word (after a click on the word in the heat map),
   with the number of citations (the number of times that the quotation is cited in the corpus).
   A click on a quotation shows the texts in which it is cited. */
function showQuotationsOfWord(suraAya, rows, word) {
    showQuotationTable(suraAya, rows, word, "#wordDetails");
}

/* The table of the quotations of a verse that contain a word, or of all its quotations (word is null), in an element */
function showQuotationTable(suraAya, rows, word, target) {
    const quotations = quotationsAtWord(rows, word, NGRAM_LENGTH_OFFSET);
    const words = ayaTextD[suraAya].split(" ");
    // the citations of the verse that contain the word (a citation is one place in a text that cites a quotation):
    const covering = word === null ? rows
        : rows.filter(d => d.ngram_start <= word && word <= d.ngram_start + d.ngram_length + NGRAM_LENGTH_OFFSET - 1);
    const nTexts = new Set(covering.map(d => d.text_id)).size;
    const what = word === null ? "" : ` ${quotations.length === 1 ? "contains" : "contain"} the word <span dir="rtl">${words[word - 1]}</span>,`;
    let html = `<p>${plural(quotations.length, "different quotation", "different quotations")} of verse ${suraAya}${what} ` +
               `cited ${plural(covering.length, "time", "times")} in ${plural(nTexts, "text", "texts")} ` +
               `(words in grey are in the neighbouring verses; click on a quotation to see the texts in which it is cited):</p>`;
    html += '<table dir="rtl"><tr><th>Quoted Quran text</th><th>citations</th><th>texts</th></tr>';
    quotations.slice(0, word === null ? 300 : undefined).forEach((q, i) => {
        const selectedToken = word === null ? null : quranRanges.verses[suraAya][0] + word - 1;
        html += `<tr class="quotationRow" data-i="${i}" style="cursor: pointer">` +
                `<td>${quotationHtml(suraAya, q, selectedToken)}</td><td>${q.count}</td><td>${q.nTexts}</td></tr>`;
    });
    html += '</table>';
    d3.select(target).html(html);
    d3.selectAll(`${target} tr.quotationRow`).on("click", function() {
        // the texts are shown in a row right below the quotation; a second click on the quotation closes it:
        const wasOpen = this.nextElementSibling && this.nextElementSibling.classList.contains("textsRow");
        d3.selectAll(`${target} tr.textsRow`).remove();
        d3.selectAll(`${target} tr.quotationRow`).style("background-color", null);
        if (wasOpen) {
            return;
        }
        d3.select(this).style("background-color", "#e5e5e5");
        const cell = d3.select(this.parentNode.insertBefore(document.createElement("tr"), this.nextSibling))
            .attr("class", "textsRow")
            .append("td").attr("colspan", 3).attr("dir", "ltr");
        showTextsOfQuotation(suraAya, rows, quotations[+this.dataset.i], cell);
    });
}

/* The filters that are not at their default value, as text: "1-300 AH, 2-300 words" (empty if there are none) */
function describeActiveFilters() {
    // [id of the input fields, text before the range, text after the range]
    const filters = [
        ["century", "century ", ""],
        ["year", "", " AH"],
        ["len", "", " words"],
    ];
    const parts = [];
    for (const [id, before, after] of filters) {
        const min = document.getElementById(`${id}InputMin`);
        const max = document.getElementById(`${id}InputMax`);
        if (min.value !== min.defaultValue || max.value !== max.defaultValue) {
            parts.push(`${before}${min.value}-${max.value}${after}`);
        }
    }
    if (search) {
        parts.push(`search "${document.getElementById("searchInput").value.trim()}"`);
    }
    return parts.join(", ");
}

// the number of words that are shown before and after a citation:
const CONTEXT_WORDS = 40;
var milestoneFiles = new Map();   // url of a file of the i.mech-20 repository: promise of its text

/* The text of a file of the i.mech-20 repository (each file is loaded once) */
function fetchMilestoneFile(url) {
    if (!milestoneFiles.has(url)) {
        const promise = fetch(url).then(response => {
            if (!response.ok) {
                throw new Error(`${url}: ${response.status}`);
            }
            return response.text();
        });
        promise.catch(() => milestoneFiles.delete(url));   // (so that it can be tried again)
        milestoneFiles.set(url, promise);
    }
    return milestoneFiles.get(url);
}

/* The places where the milestones of each text deviate from 300 tokens (see quotations.js, borderShift):
   a promise of the content of @milestone_borders_<release>.json, or of undefined if there is no such file
   (then the position of a citation in the milestones is estimated) */
var milestoneBordersPromise;
function loadMilestoneBorders() {
    if (!milestoneBordersPromise) {
        milestoneBordersPromise = d3.json(`${dataFolder}/@milestone_borders_${release}.json`).catch(error => {
            console.warn("The milestone borders could not be loaded: the place of the citations is estimated.", error);
            return undefined;
        });
    }
    return milestoneBordersPromise;
}

/* Show a citation in its context (the words before and after it) in an element:
   textUri: the version URI of the text; citation: {start, end}, the first and the last token of the citation in the text;
   q: the quotation (qstart and qend: its words in the Qurʾān, used to check that the right words are shown) */
function showCitationContext(textUri, citation, q, element) {
    element.html("Loading the text...");
    const quranWords = [];
    for (let i = q.qstart; i <= q.qend; i++) {
        quranWords.push(qTokensD[i][0]);
    }
    const textId = textIdOfUri(textUri);
    loadMilestoneBorders().then(borders => {
        // (a text that is not in the file has milestones of 300 tokens; without the file they are estimated)
        const shifts = borders ? (borders.data[textId] || []) : undefined;
        return loadCitationContext(release, textId, citation.start, citation.end, CONTEXT_WORDS, CONTEXT_WORDS,
                                   fetchMilestoneFile, quranWords, shifts);
    }).then(context => {
        if (!context) {
            element.html("This place was not found in the text of the milestones.");
            return;
        }
        const paragraph = text => escapeHtml(text).replace(/\n/g, "<br>");
        let html = `<div dir="rtl" style="font-size: 20px; line-height: 1.8">${paragraph(context.before)}` +
                   `<mark>${paragraph(context.quote)}</mark>${paragraph(context.after)}</div>`;
        if (!context.matchesQuran) {
            html += '<p dir="ltr" style="color: #a00">Warning: the words of the Qurʾān are not (all) in the highlighted words. ' +
                    'The text of the milestones may differ from the text that was analysed.</p>';
        }
        element.html(html);
    }).catch(error => {
        console.error(error);
        element.html("The text could not be loaded (click again to try again).");
    });
}

/* Show the places in a text that cite a quotation, each with a link to its context, in the table cell */
function showCitationsOfText(textUri, citations, q, cell) {
    if (!textUri) {
        cell.html("<p>The name of the text is not known.</p>");
        return;
    }
    cell.html(`<p>${plural(citations.length, "place", "places")} in the text (words are counted from the start of the text):</p>`);
    citations.forEach(c => {
        const item = cell.append("div").style("margin-bottom", "8px");
        const link = item.append("a").attr("href", "#").style("cursor", "pointer")
            .text(`words ${c.start + 1}-${c.end + 1}: show in context`);
        const context = item.append("div");
        const show = () => showCitationContext(textUri, c, q, context);
        link.on("click", event => {
            event.preventDefault();
            show();
        });
        if (citations.length === 1) {
            show();   // (one place: no need to click)
        }
    });
}

/* Show the texts in which a quotation of a verse is cited (earliest first) in the table cell */
function showTextsOfQuotation(suraAya, rows, q, div) {
    const texts = textsOfQuotation(rows, q.qstart, q.qend);
    div.html("<p>Loading...</p>");
    loadTextIds().then(textIds => {
        const filters = describeActiveFilters();
        let html = `<p>Cited ${q.count} ${q.count === 1 ? "time" : "times"} in ${texts.length} ${texts.length === 1 ? "text" : "texts"}` +
                   `${filters ? ` (filters: ${filters})` : ""}:</p>`;
        html += '<table dir="ltr"><tr><th>year (AH)</th><th>text</th><th>citations</th></tr>';
        texts.forEach(t => {
            html += `<tr class="textRow" data-text="${t.textId}" style="cursor: pointer" title="Click to see the citations in their context">` +
                    `<td>${t.year}</td><td>${textIds[t.textId] || ("text " + t.textId)}</td><td>${t.count}</td></tr>`;
        });
        html += "</table>";
        div.html(html);
        div.selectAll("tr.textRow").on("click", function() {
            // the citations are shown in a row right below the text; a second click on the text closes it:
            const wasOpen = this.nextElementSibling && this.nextElementSibling.classList.contains("citationsRow");
            div.selectAll("tr.citationsRow").remove();
            div.selectAll("tr.textRow").style("background-color", null);
            if (wasOpen) {
                return;
            }
            d3.select(this).style("background-color", "#e5e5e5");
            const textId = this.dataset.text;
            const cell = d3.select(this.parentNode.insertBefore(document.createElement("tr"), this.nextSibling))
                .attr("class", "citationsRow")
                .append("td").attr("colspan", 3).attr("dir", "ltr");
            showCitationsOfText(textIds[textId], citationsOfText(rows, q.qstart, q.qend, textId), q, cell);
        });
    }).catch(error => {
        console.error(error);
        div.html("<p>The names of the texts could not be loaded.</p>");
    });
}

/* The html of a verse in which each word is coloured by the number of quotations that contain the word
   (only the quotations that agree with the filters). */
/* The tooltip of a word of the heat map */
function wordTitle(count, nQuotations) {
    return `this word is part of ${plural(count, "citation", "citations")} of this verse ` +
           `(${plural(nQuotations, "different quotation", "different quotations")}). Click it to see the quotations.`;
}

function formatAyaHeatMap(suraAya, rows) {
    const ayaTokens = ayaTextD[suraAya].split(" ");
    const hits = searchHits(...quranRanges.verses[suraAya]);   // (the words of the search term: bold and italic)
    const firstToken = quranRanges.verses[suraAya][0];
    const counts = tokenCounts(rows, ayaTokens.length, NGRAM_LENGTH_OFFSET);
    const [min, max] = d3.extent(counts);
    if (max === 0) {
        return `<p>${suraAya}: ${verseTextHtml(suraAya)}</p><p dir="ltr">There are no citations of this verse that agree with the filters.</p>`;
    }
    const colorScale = (min === max)
        ? () => "orange"
        : d3.scaleLinear()
            .domain([min, (min + max) / 2, max])
            .range(["lightyellow", "orange", "purple"]);
    let html = `<p>${suraAya}: `;
    ayaTokens.forEach((token, i) => {
        html += `<span data-word="${i + 1}" title="${wordTitle(counts[i], quotationsAtWord(rows, i + 1, NGRAM_LENGTH_OFFSET).length)}" style="direction: ltr; cursor: pointer; background-color: ${colorScale(counts[i])}">${markedWord(token, hits && hits.has(firstToken + i), false)} </span>`;
    });
    html += `</p><p dir="ltr">Colour represents the number of citations that contain the word ` +
            `(lightest: ${min}, darkest: ${max}; hover over a word to see the exact number).</p>` +
            `<p dir="ltr">Click on a word to see all quotations that contain it.</p>` +
            `<div id="wordDetails" dir="ltr"></div>`;
    return html;
}

function calculateLargestCount(qdata) {
    //const dataByAya = d3.flatRollup(qdata, v => d3.sum(v, d => d.count), d => d.sura, d => d.aya);
    //const countsByAya = Array.from(dataByAya, ([_sura, _aya, count]) => count);
    const dataByAya = d3.flatRollup(qdata, v => d3.sum(v, d => d.count), d => d.sura_aya);
    //console.log(dataByAya);
    const countsByAya = Array.from(dataByAya, ([_sura_aya, count]) => count);
    //console.log(countsByAya);
    maxAyaY = d3.max(countsByAya); 
    return maxAyaY;
}


// build the filters:
setupFilters();

/* Load (once) the stats file: the quotations at their first location in the Qurʾān.
   It is only needed for the "first location" graphs, so it is loaded when the user asks for them. */
function loadStats() {
    if (!statsPromise) {
        statsPromise = d3.dsv("\t", allStatsFp).then(function(data) {
            //header: century	year	sura	aya	count

            // make sure the relevant data are formatted as numbers
            // and add a column to identify each aya:
            data.forEach(d => {
                d.sura = +d.sura;
                d.aya = +d.aya;
                d.count = +d.count;
                d.century = +d.century;
                d.year = +d.year;
                d.sura_aya = `${d.sura}.${d.aya}`;
            });
            qdata = data;
            // the number of times the most frequently reused aya is used
            maxAyaY = calculateLargestCount(qdata);
            return data;
        });
        statsPromise.catch(() => { statsPromise = undefined; });   // (so that it can be tried again)
    }
    return statsPromise;
}

// start the big downloads at the same time (the parsing of each of them starts when it has arrived):
const quranTextPromise = d3.text(quranTextFp);
const repeatedJsonPromise = d3.json("resources/first_repeated_quran_ngrams.json");
if (document.getElementById("allLocationsBtn").checked) {
    loadNgrams();   // (all locations is the default: the counts are made of the ngrams)
} else {
    loadStats();
}
d3.select("#locationsStatus").text("Loading the data...");

{
    quranTextPromise.then(function(qtext) {
        // add a header:
        qtext = "sura|aya|aya_text\n" + qtext;
        // remove the metadata footer:
        qtext = qtext.replace(/[\n\r]+#.*/g, "").trimEnd();
        // replace the pipe delimiter by tab:
        qtext = qtext.replace(/\|/g, "\t");
        // create a dataframe:
        qtext = d3.tsvParse(qtext);
        
        /*qtext.forEach((d, index) => {
            d.sura = +d.sura;
            d.aya = +d.aya;
            d.sura_aya = `${d.sura}.${d.aya}`;
            ayaTokenIndexD[`${d.sura}.${d.aya}`] = index+1;
        });*/
        // build lookup dictionaries:
        let qtoken = 0;
        for (let i=0; i<qtext.length; i++){
            let d = qtext[i];
            let suraAya = `${d.sura}.${d.aya}`
            ayaTokenIndexD[suraAya] = i+1;
            ayaKeys.push(suraAya);
            ayaWords[suraAya] = d.aya_text.split(" ").length;
            suraWords[d.sura] = (suraWords[d.sura] || 0) + ayaWords[suraAya];
            ayasInSura[d.sura] = Math.max(ayasInSura[d.sura] || 0, +d.aya);
            ayaTextD[suraAya] = d.aya_text;
            let ayaTokens = d.aya_text.split(" ");
            for (let j=0; j<ayaTokens.length; j++) {
                qTokensD[qtoken] = [ayaTokens[j], `${suraAya}.${j + 1}`];
                qTokenIndexD[`${suraAya}.${j + 1}`] = qtoken;
                verseOfToken.push(i);
                normTokens.push(normaliseArabic(ayaTokens[j]));
                qtoken += 1
            }
        }
        quranRanges = buildRanges(qTokensD);
        

        repeatedNgramsReady = repeatedJsonPromise.then(data => {
            repeatedNgramsD = data["data"];
            repeatedLookupD = buildRepeatedLookup(repeatedNgramsD);
        });
        // "all locations" is the default: the graphs are drawn when the counts are ready
        updateData();

    }).catch(error => {
        console.error(error);
        d3.select("#locationsStatus").text("The data could not be loaded.");
    });
}
