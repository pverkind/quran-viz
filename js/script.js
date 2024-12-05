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
var repeatedNgramsD = new Object();


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
    d3.select("#ayaTextDiv p").remove();
    d3.select("#table div").remove();
}

function filterArray(data) {
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
        d.sura >= suraMin && d.sura <= suraMax &&
        d.aya >= ayaMin && d.aya <= ayaMax
    );
    console.log("Number of rows after filtering: "+ filteredData.length);
    return filteredData; 
}

function updateVisuals() {
    removeAllGraphs();

    const filteredData = filterArray(qdata);

    if (suraVizBtn.checked) {
        createScatterPlot("#scatter1", filteredData, "sura", "count", "Suras", null, 400);
        if (suraMin == suraMax){
            createScatterPlot("#scatter2", filteredData, "aya", "count", "Verses", suraMin, 400);
        }
    } else if (ayaVizBtn.checked){
        createScatterPlot("#scatter1", filteredData, "sura_aya", "count", "All Verses", null, 800);
    } else if (tableVizBtn.checked){
        buildTableViz();
    }
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
    const svg = d3.select(container)
        .append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
                .attr("transform", `translate(${margin.left},${margin.top})`);
    
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
    
    // then the circles:
    svg.selectAll(".dot")
        .data(formattedData)
        .enter()
        .append("circle")
            .attr("class", "dot")
            .attr("cx", d => x(d[xVar]))
            .attr("cy", d => y(d[yVar]))
            .attr("r", 5)
            //.attr("fill", "blue") // default color
            .style("fill", "blue")
            .style("opacity", 0)
            .on("mouseover", function(event, d) {
                console.log("CLICKED!");
                console.log(d);
                d3.selectAll(".dot").style("fill", "blue").style("opacity", 0);
                d3.select(this).style("fill", "red").style("opacity", 0.5);
                d3.select("#ayaTextDiv p").remove();
                if (title === "Suras") {
                    filterScatter2(d, data);
                } else {
                    //[sura, aya] = d.sura_aya.split(".");
                    //let formattedAya = formatAyaText(sura, aya);
                    //d3.select("#ayaTextDiv").html(`<p>${formattedAya}<br>NB: coloring is supposed to show which parts of the aya are more often quoted than others. This feature is experimental and not working well yet (it's concerning that the last part of an aya is almost always heavier reused than the beginning, I need to check whether this is a data problem)</p>`); 
                    d3.select("#ayaTextDiv").html(`<p>${d.sura_aya}: ${ayaTextD[d.sura_aya]}</p>`)
                }
            });
    
    // add the title to the graph:
    if (title == "Verses") {
        title = "Verses in sura "+sura;
    }
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", margin.top)
        .attr("text-anchor", "middle")
        .text(title);
}


function filterScatter2(clickedDotD, qdata) {
    console.log(clickedDotD);
    d3.select("#scatter2 svg").remove();
    const filteredData = qdata.filter(d => d.sura == clickedDotD.sura);
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
    return filteredData

}

function quranTextFromIndices(start, end){
    let qstr = "";
    for (let i=start; i<end+1; i++){
        qstr += qTokensD[i][0] + " ";
    }
    return qstr.trimEnd();
}

function getAllSuras(start, end){
    let suraAyaTok = qTokensD[end][1];
    let repeated = repeatedNgramsD[suraAyaTok+"."+(end-start)] || [];
    console.log(repeated);
    let suraAya = suraAyaTok.split(".").slice(0,2).join(".");
    suraAya = `<span title="${ayaTextD[suraAya]}">${suraAya}</span>`;
    if (repeated.length > 0){
        let nVerses = (repeated.length == 1) ? "1 other verse" : `${repeated.length} other verses`; 
        // keep only the sura and aya number for the repeats:
        repeated = repeated.map(s => s.split(".").slice(0,2).join("."));
        suraAya += `<br>(and <span title="${repeated.join(', ')}">${nVerses}</span>)`;
    }
    
    return suraAya;
}

function buildTable(data){
    const filteredData = filterNgrams(data);
    // group by ngram (start and end token), and sum up the counts for each ngram:
    let rolled = d3.flatRollup(
        filteredData, 
        v => d3.sum(v, d => d.count), 
        d => d.start_token, d => d.end_token);
    // rolled is now an array of sub-arrays: [start_token, end_token, count]
    // sort the ngrams by frequency:
    rolled.sort((a,b) => b[2]-a[2]);
    // keep only the top 300 ngrams:
    let top = rolled.slice(0,300);
    // convert the start and end tokens into the ngram:
    top = top.map(arr => [quranTextFromIndices(arr[0], arr[1]), getAllSuras(arr[0], arr[1]), arr[2]])
    // build the caption:
    let caption = `<p>Displaying the 300 most frequent quotations (out of ${rolled.length} that agree with the filters):</p>`
    // build the table html: 
    let table = '<table dir="rtl"><tr><th>Quoted Quran text</th><th>Verse</th><th>frequency</th></tr>';
    top.forEach(arr => {
        table += "<tr>";
        arr.forEach(el => table += `<td>${el}</td>`);
        table += "</tr>";
        //table += `<tr><td>${ar[0]}</td><td><span title="${ayaTextD[arr[1]]}">${arr[1]}</span></td><td>ar[2]</td></tr>`
    });
    table += "</table>";
    d3.select("#table").html(`<div>${caption}${table}</div>`);
}

/*Display a table displaying the top X ngrams*/
function buildTableViz(){
    removeAllGraphs()
    if (typeof ngrams === 'undefined') {
        const fp =  `${dataFolder}/@ngrams_count_${release}.csv`;
            d3.csv(fp).then(data => {
                data.forEach(d => {
                    d.start_token = +d.start_token;
                    d.end_token = +d.end_token;
                    d.year = +d.year;
                    d.century = Math.ceil(d.year/100);
                    d.len = d.end_token - d.start_token;
                })
                ngrams = data;
                buildTable(data);
        });
    } else {
        buildTable(ngrams);
    }
    
}

function parseAyaData(ayaData) {
    // create an array filled with zeroes:
    const tokenData = new Array(100).fill(0);

    // TODO: filter ayaData (by year/century/ngram_freq/...)
    ayaData = filterArray(ayaData)

    // increment the count for each token in the ngram:
    ayaData.forEach(d => {
        for (let i=d.ngram_start; i<d.ngram_start+d.ngram_length+1; i++) {
            tokenData[i-1] += 1;
        }
    })
    return tokenData
}

function formatAyaText(sura, aya){
    const suraAya = `${sura}.${aya}`;
    const fp = `${dataFolder}/${suraAya}.csv`;
    const ayaTokens = ayaTextD[suraAya].split(" ");
    d3.csv(fp).then(function(ayaData) {
        ayaData.forEach(d => {
            d.ngram_start = +d.ngram_start;
            d.ngram_length = +d.ngram_length;
            d.century = +d.century;
            d.year = +d.year;
            d.sura = +sura;
            d.aya = +aya;
        })
        const tokenCounts = parseAyaData(ayaData);
        let domain = d3.extent(tokenCounts);
        const colorScale = d3
            .scaleLinear()
            .domain([domain[0], (domain[0] + domain[1])/2, domain[1]])
            //.domain([0,maxAyaY])
            .range(['lightyellow', 'orange', 'purple']);
        let formattedAya = `${sura}.${aya}: `;
        for (i=0; i<ayaTokens.length; i++) {
            formattedAya += `<span style="background-color: ${colorScale(tokenCounts[i])}">${ayaTokens[i]} </span>`
        }
        return formattedAya;
        
    });
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
            ayaTextD[suraAya] = d.aya_text;
            let ayaTokens = d.aya_text.split(" ");
            for (let j=0; j<ayaTokens.length; j++) {
                qTokensD[qtoken] = [ayaTokens[j], `${suraAya}.${j}`];
                qtoken += 1
            }
        }
        

        // create the sura scatter plot
        buildSuraLevelViz();

        d3.json("resources/first_repeated_quran_ngrams.json").then(data => {
            repeatedNgramsD = data["data"];
        });

    });
});
