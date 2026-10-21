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
const allStatsFp = `${dataFolder}/@quran_data_stats_all_${release}.tsv`;

// buttons:
const resetBtn = document.getElementById("resetFiltersBtn");
resetBtn.addEventListener("click", resetFilters);
const suraVizBtn = document.getElementById("suraVizBtn");
suraVizBtn.addEventListener("click", buildSuraLevelViz);
const ayaVizBtn = document.getElementById("ayaVizBtn");
ayaVizBtn.addEventListener("click", buildAyaLevelViz);
const tableVizBtn =  document.getElementById("tableVizBtn");
tableVizBtn.addEventListener("click", buildTableViz);

// global variables, to be filled in asynchronously:
var maxAyaY, qdata, ngrams;
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
    
    updateVisuals()
}

function removeAllGraphs(){
    d3.select("#scatter1 svg").remove();
    d3.select("#scatter2 svg").remove();
    d3.select("#ayaTextDiv").html("");
    currentAyaKey = null;
    heatmapVerse = null;
    selectedWord = null;
    verseSura = null;
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

function updateVisuals() {
    // the verse (or its heat map, and the selected word) that is shown stays visible, with the new filters:
    const keep = {
        html: d3.select("#ayaTextDiv").html(),
        verse: currentAyaKey, heatmapVerse, selectedWord, locked: heatmapLocked, verseSura,
        highlightedSura, highlightedVerse, suraLocked
    };
    removeAllGraphs();
    if (keep.verse && !tableVizBtn.checked) {
        d3.select("#ayaTextDiv").html(keep.html);   // (until the heat map is drawn again)
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
        createScatterPlot("#scatter1", filterArray(qdata, {aya: true}), "sura", "count", "Suras", null, 400);
        // the verses of the sura that the user has selected (or of the only sura that the filter allows):
        const sura = (suraMin == suraMax) ? suraMin : keep.verseSura;
        if (sura && sura >= suraMin && sura <= suraMax) {
            verseSura = sura;
            createScatterPlot("#scatter2", filterArray(qdata).filter(d => d.sura == sura), "aya", "count", "Verses", sura, 400);
        }
    } else if (ayaVizBtn.checked){
        createScatterPlot("#scatter1", filterArray(qdata), "sura_aya", "count", "All Verses", null, 800);
    } else if (tableVizBtn.checked){
        buildTableViz();
    }

    if (keep.heatmapVerse && !tableVizBtn.checked) {
        showAyaHeatMap(keep.heatmapVerse);
    }
}

/* Filter the rows of a verse file (the quotations of one verse): by century, year, sura, aya
   and the length of the quotation (in words) */
function filterVerseRows(rows) {
    const lenMin = +d3.select("#lenInputMin").property("value");
    const lenMax = +d3.select("#lenInputMax").property("value");
    return filterArray(rows, {sura: true, aya: true}).filter(d => {
        const len = d.ngram_length + NGRAM_LENGTH_OFFSET;
        return len >= lenMin && len <= lenMax;
    });
}



function createScatterPlot(container, data, xVar, yVar, title, sura, width) {
    // format data for the scatterplot:
    const aggregatedData = d3.flatRollup(data, v => d3.sum(v, d => d[yVar]), d => d[xVar]);
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
    
    const height = 400;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    
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
    
    // build x and y scales:
    const x = d3.scaleLinear()
        //.domain(d3.extent(formattedData, d => d[xVar])).nice()
        //.domain([0, d3.max(formattedData, d => d[xVar])]).nice()
        .domain([d3.min(formattedData, d => d[xVar])-1, d3.max(formattedData, d => d[xVar])])//.nice()
        .range([0, width]);
    
    const y = d3.scaleLinear()
        //.domain(d3.extent(formattedData, d => d[yVar])).nice()
        //.domain([0, container=="#scatter1" ? d3.max(formattedData, d => d[yVar]) : maxAyaY]).nice()
        .domain([0, d3.max(formattedData, d => d[yVar])])//.nice()
        .range([height, 0]);
    
    
    // add x and y axes:

    // make sure X axis ticks are only integers:
    const xAxisTicks = x.ticks()
        .filter(tick => Number.isInteger(tick));
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x)
          .tickValues(xAxisTicks)
          .tickFormat(d3.format('d'))
        );
    
    svg.append("g")
        .call(d3.axisLeft(y));        

    // first create the vertical lines of the lollipops:
    svg.selectAll("myline")
        .data(formattedData)
        .enter()
        .append("line")
          .attr("x1", d => x(d[xVar]))
          .attr("x2", d => x(d[xVar]))
          .attr("y1", d => y(d[yVar]))
          .attr("y2", y(0))
          .attr("stroke", "blue")
    
    // The mouse handlers are shared by the dots and by the (wide, invisible) lines of the bars,
    // so that a bar can be selected by hovering over it or clicking on it, not only its top.
    // Hovering is disabled after a click on a bar (until the user clicks in the graph):
    const isSuraPlot = (title === "Suras");
    function isLocked() { return isSuraPlot ? suraLocked : heatmapLocked; }
    function setLocked(value) { if (isSuraPlot) { suraLocked = value; } else { heatmapLocked = value; } }

    // the circle of a bar (only the circles of this graph: the other graph has its own selected bar):
    const dotOf = d => svg.selectAll(".dot").filter(e => e === d);
    function highlight(d) {
        svg.selectAll(".dot").style("fill", "blue").style("opacity", 0);
        dotOf(d).style("fill", "red").style("opacity", 0.5);
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
            showHint(x(d[xVar]), y(d[yVar]));
        }
    }

    // the wide, invisible lines on top of the visible lines of the bars:
    svg.selectAll(".hitline")
        .data(formattedData)
        .enter()
        .append("line")
            .attr("class", "hitline")
            .attr("x1", d => x(d[xVar]))
            .attr("x2", d => x(d[xVar]))
            .attr("y1", d => y(d[yVar]))
            .attr("y2", y(0))
            .attr("stroke", "transparent")
            .attr("stroke-width", 10)
            .style("pointer-events", "stroke")
            .style("cursor", "pointer")
            .on("mouseover", onMouseOver)
            .on("mouseout", () => hint.style("display", "none"))
            .on("click", onClick);

    // then the circles:
    svg.selectAll(".dot")
        .data(formattedData)
        .enter()
        .append("circle")
            .attr("class", "dot")
            .attr("cx", d => x(d[xVar]))
            .attr("cy", d => y(d[yVar]))
            .attr("r", 5)
            .style("fill", "blue")
            .style("opacity", 0)
            .style("cursor", "pointer")
            .on("mouseover", onMouseOver)
            .on("mouseout", () => hint.style("display", "none"))
            .on("click", onClick);

    // the sura or verse that was selected before the graph was drawn again stays highlighted:
    const selected = isSuraPlot ? highlightedSura : highlightedVerse;
    if (selected !== null) {
        svg.selectAll(".dot").filter(d => (isSuraPlot ? d.sura : d.sura_aya) == selected)
            .style("fill", "red").style("opacity", 0.5);
    }

    // add the title to the graph:
    if (title == "Verses") {
        title = "Verses in sura "+sura;
    }
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", margin.top)
        .attr("text-anchor", "middle")
        .text(title);

    // draw the hint on top of the lines and dots:
    hint.raise();
}


/* Show the verses of a sura (that the mouse is over, or that the user has clicked on) in the second graph.
   If it is another sura than the one that was shown, the aya filter is reset to all the verses of the sura. */
function filterScatter2(clickedDotD) {
    d3.select("#scatter2 svg").remove();
    if (verseSura !== clickedDotD.sura) {
        document.getElementById("ayaInputMin").value = 1;
        document.getElementById("ayaInputMax").value = ayasInSura[clickedDotD.sura];
        verseSura = clickedDotD.sura;
        highlightedVerse = null;
    }
    const filteredData = filterArray(qdata).filter(d => d.sura == clickedDotD.sura);
    createScatterPlot("#scatter2", filteredData, "aya", "count", "Verses", clickedDotD.sura, 400);
}

function buildSuraLevelViz(){
    removeAllGraphs()
    createScatterPlot("#scatter1", qdata, "sura", "count", "Suras", null, 400);
}

function buildAyaLevelViz() {
    removeAllGraphs()
    createScatterPlot("#scatter1", qdata, "sura_aya", "count", "All Verses", null, 800);
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
        d.len >= lenMin && d.len <= lenMax
    );

    console.log("Number of rows after filtering: "+ filteredData.length);
    return filteredData;

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
function getAllSuras(key){
    let repeated = repeatedNgramsD[key] || [];
    let suraAya = key.split(".").slice(0,2).join(".");
    suraAya = `<span class="ttanchor" title="${ayaTextD[suraAya]}">${suraAya}</span>`;
    if (repeated.length > 0){
        let nVerses = (repeated.length == 1) ? "1 other verse" : `${repeated.length} other verses`;
        // keep only the sura and aya number for the repeats:
        repeated = repeated.map(s => s.split(".").slice(0,2).join("."));
        suraAya += `<br><span class="ttanchor" dir="ltr" title="${repeated.join(', ')}">(and ${nVerses})</span>`;
    }

    return suraAya;
}

/* The verses of the appearances of a quotation that are in a part of the Qurʾān (a sura or a verse), as html.
   appearances: see filterQuotationsByRange */
function getVersesInPart(appearances){
    const verses = [];
    appearances.forEach(a => {
        const v = a.location.split(".").slice(0,2).join(".");
        if (!verses.includes(v)) {
            verses.push(v);
        }
    });
    let html = `<span class="ttanchor" title="${ayaTextD[verses[0]]}">${verses[0]}</span>`;
    if (verses.length > 1) {
        const others = verses.slice(1);
        html += `<br><span class="ttanchor" dir="ltr" title="${others.join(', ')}">(and ${others.length} more here)</span>`;
    }
    return html;
}

/* Merge the rows of the same quotation at different locations in the Quran
   (e.g. the basmala at the start of sura 1 and at the start of sura 2), and sum up the counts:
   [{key: key of the first appearance of the quotation, count: count}, ...] sorted by frequency */
function mergeFilteredNgrams(data){
    return mergeQuotations(filterNgrams(data), qTokensD, repeatedLookupD);
}

/* Show the top 300 quotations in the table.
   quotations: [{key, count, appearances (optional)}, ...]
   caption: html of the caption (use ${n} for the number of quotations)
   verseHtml: function that returns the html of the verse(s) of a quotation */
function renderQuotationTable(quotations, caption, verseHtml){
    // keep only the top 300 quotations
    // and convert the keys into the text of the quotation, the verse(s) and the frequency:
    const top = quotations.slice(0,300).map(q => {
        const ngram = parseQuotationKey(q.key, qTokenIndexD);
        return [quranTextFromIndices(ngram.start, ngram.end), verseHtml(q), q.count];
    });
    let table = '<table dir="rtl"><tr><th>Quoted Quran text</th><th>Verse</th><th>frequency</th></tr>';
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
        "Displaying the 300 most frequent quotations (out of ${n} that agree with the filters; the same quotation in different verses is counted as one):",
        q => getAllSuras(q.key));
}

/* Show the table of the quotations that occur in a sura or a verse (after a click in the sura-level or verse-level graph)
   type: "sura" or "verse"
   id: the number of the sura ("2") or the verse ("2.255") */
function showQuotationsOf(type, id){
    const thisSelection = ++selectionCounter;
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
            `Quotations of ${name}: displaying the 300 most frequent quotations (out of \${n} that agree with the filters; ` +
            `frequency: the number of times the quotation is cited in the corpus, wherever it occurs in the Qurʾān):`,
            q => getVersesInPart(q.appearances));
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
var ayasInSura = new Object();  // sura: number of verses in the sura
var highlightedSura = null;     // the sura whose circle is red in the graph of suras
var highlightedVerse = null;    // the verse ("sura.aya") whose circle is red in the graph of verses
var suraLocked = false;         // True after a click on a bar of the graph of suras (hovering is disabled)
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

/* Show the text of a verse (when the mouse is over the dot at the top of its bar) */
function showAya(suraAya) {
    if (currentAyaKey === suraAya) {
        return;   // (it is shown already; this keeps the heat map if the mouse enters the same dot again)
    }
    currentAyaKey = suraAya;
    heatmapVerse = null;
    selectedWord = null;
    d3.select("#ayaTextDiv").html(
        `<p>${suraAya}: ${ayaTextD[suraAya]}</p>` +
        `<p dir="ltr" id="heatmapStatus"></p>`);
}

/* Show the verse with each word coloured by the number of quotations that contain the word

   (Earlier observation: the last part of a verse seemed to be reused more often than the beginning.
   To be checked in the data: the cause can be the data, not the code.) */
function showAyaHeatMap(suraAya) {
    const [sura, aya] = suraAya.split(".");
    showAya(suraAya);   // (does nothing if the verse is shown already)
    d3.select("#heatmapStatus").text("Loading the heat map...");
    loadAyaData(sura, aya).then(rows => {
        if (currentAyaKey !== suraAya) {
            return;   // the mouse has moved to another verse in the meantime
        }
        const filteredRows = filterVerseRows(rows);
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
        textIdsPromise = d3.json("resources/_text_ids.json");
        textIdsPromise.catch(() => { textIdsPromise = undefined; });   // (so that it can be tried again)
    }
    return textIdsPromise;
}

/* The words of a verse that a quotation (see quotationsAtWord) covers, with "..." where it continues in another verse */
function quotationTextInVerse(suraAya, q) {
    const words = ayaTextD[suraAya].split(" ");
    const first = Math.max(q.start, 1);
    const last = Math.min(q.start + q.length - 1, words.length);
    return (q.start < 1 ? "... " : "") + words.slice(first - 1, last).join(" ") + (q.start + q.length - 1 > words.length ? " ..." : "");
}

/* Show the quotations of a verse that contain a word (after a click on the word in the heat map),
   with their frequency (the number of times that the quotation is cited in the corpus).
   A click on a quotation shows the texts in which it is cited. */
function showQuotationsOfWord(suraAya, rows, word) {
    const quotations = quotationsAtWord(rows, word, NGRAM_LENGTH_OFFSET);
    const words = ayaTextD[suraAya].split(" ");
    let html = `<p>Quotations of verse ${suraAya} that contain the word <span dir="rtl">${words[word - 1]}</span> ` +
               `(${quotations.length} quotations; click on a quotation to see the texts in which it is cited):</p>`;
    html += '<table dir="rtl"><tr><th>Quoted Quran text</th><th>times cited</th><th>texts</th></tr>';
    quotations.forEach((q, i) => {
        html += `<tr class="quotationRow" data-i="${i}" style="cursor: pointer">` +
                `<td>${quotationTextInVerse(suraAya, q)}</td><td>${q.count}</td><td>${q.nTexts}</td></tr>`;
    });
    html += '</table>';
    d3.select("#wordDetails").html(html);
    d3.selectAll("#wordDetails tr.quotationRow").on("click", function() {
        // the texts are shown in a row right below the quotation; a second click on the quotation closes it:
        const wasOpen = this.nextElementSibling && this.nextElementSibling.classList.contains("textsRow");
        d3.selectAll("#wordDetails tr.textsRow").remove();
        d3.selectAll("#wordDetails tr.quotationRow").style("background-color", null);
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
    return parts.join(", ");
}

/* Show the texts in which a quotation of a verse is cited (earliest first) in the table cell */
function showTextsOfQuotation(suraAya, rows, q, div) {
    const texts = textsOfQuotation(rows, q.start, q.length, NGRAM_LENGTH_OFFSET);
    div.html("<p>Loading...</p>");
    loadTextIds().then(textIds => {
        const filters = describeActiveFilters();
        let html = `<p>Cited ${q.count} ${q.count === 1 ? "time" : "times"} in ${texts.length} ${texts.length === 1 ? "text" : "texts"}` +
                   `${filters ? ` (filters: ${filters})` : ""}:</p>`;
        html += '<table dir="ltr"><tr><th>year (AH)</th><th>text</th><th>times cited</th></tr>';
        texts.forEach(t => {
            html += `<tr><td>${t.year}</td><td>${textIds[t.textId] || ("text " + t.textId)}</td><td>${t.count}</td></tr>`;
        });
        html += "</table>";
        div.html(html);
    }).catch(error => {
        console.error(error);
        div.html("<p>The names of the texts could not be loaded.</p>");
    });
}

/* The html of a verse in which each word is coloured by the number of quotations that contain the word
   (only the quotations that agree with the filters). */
function formatAyaHeatMap(suraAya, rows) {
    const ayaTokens = ayaTextD[suraAya].split(" ");
    const counts = tokenCounts(rows, ayaTokens.length, NGRAM_LENGTH_OFFSET);
    const [min, max] = d3.extent(counts);
    if (max === 0) {
        return `<p>${suraAya}: ${ayaTextD[suraAya]}</p><p dir="ltr">There are no quotations of this verse that agree with the filters.</p>`;
    }
    const colorScale = (min === max)
        ? () => "orange"
        : d3.scaleLinear()
            .domain([min, (min + max) / 2, max])
            .range(["lightyellow", "orange", "purple"]);
    let html = `<p>${suraAya}: `;
    ayaTokens.forEach((token, i) => {
        html += `<span data-word="${i + 1}" title="${counts[i]}" style="cursor: pointer; background-color: ${colorScale(counts[i])}">${token} </span>`;
    });
    html += `</p><p dir="ltr">Colour: the number of quotations that contain the word ` +
            `(lightest: ${min}, darkest: ${max}; hover over a word to see its number; ` +
            `click on a word to see the quotations that contain it).</p>` +
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

// load the reuse data:
d3.dsv("\t", allStatsFp).then(function(data) {
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

    // calculate the number of times the most frequently reused aya is used 
    // (to set the maximum value on the Y axis to the same value for each aya) 
    maxAyaY = calculateLargestCount(qdata);
    console.log("Most frequently reused verse: reused "+maxAyaY+" times");

    // load the Quran text:
    d3.text(quranTextFp).then(function(qtext) {
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
            ayasInSura[d.sura] = Math.max(ayasInSura[d.sura] || 0, +d.aya);
            ayaTextD[suraAya] = d.aya_text;
            let ayaTokens = d.aya_text.split(" ");
            for (let j=0; j<ayaTokens.length; j++) {
                qTokensD[qtoken] = [ayaTokens[j], `${suraAya}.${j + 1}`];
                qTokenIndexD[`${suraAya}.${j + 1}`] = qtoken;
                qtoken += 1
            }
        }
        quranRanges = buildRanges(qTokensD);
        

        // create the sura scatter plot
        buildSuraLevelViz();

        repeatedNgramsReady = d3.json("resources/first_repeated_quran_ngrams.json").then(data => {
            repeatedNgramsD = data["data"];
            repeatedLookupD = buildRepeatedLookup(repeatedNgramsD);
        });

    });
});
