
"use strict";

module("SiteSearch");

QUnit.test("tokenize strips punctuation and lowercases", function (assert) {
    assert.deepEqual(SearchEngineUI.tokenize("The Wandering Inn!"), ["the", "wandering", "inn"]);
    assert.deepEqual(SearchEngineUI.tokenize("Re:Zero - Starting Life"), ["re", "zero", "starting", "life"]);
    assert.deepEqual(SearchEngineUI.tokenize(""), []);
    assert.deepEqual(SearchEngineUI.tokenize(null), []);
});

QUnit.test("filterResultsByRelevancy ranks exact match first", function (assert) {
    let results = [
        { title: "Wandering Inn Side Stories", url: "https://a.com/1" },
        { title: "The Wandering Inn", url: "https://a.com/2" },
        { title: "Wandering", url: "https://a.com/3" },
    ];
    let ranked = SearchEngineUI.filterResultsByRelevancy(results, "the wandering inn");
    assert.equal(ranked[0].title, "The Wandering Inn", "exact match ranked first");
    assert.ok(ranked.length >= 2, "near matches retained");
});

QUnit.test("filterResultsByRelevancy keeps titles missing only a stopword", function (assert) {
    let results = [{ title: "Wandering Inn", url: "https://a.com/1" }];
    let ranked = SearchEngineUI.filterResultsByRelevancy(results, "the wandering inn");
    assert.equal(ranked.length, 1, "title missing the stopword 'the' is NOT dropped");
});

QUnit.test("filterResultsByRelevancy drops unrelated titles", function (assert) {
    let results = [
        { title: "Overlord", url: "https://a.com/1" },
        { title: "The Wandering Inn", url: "https://a.com/2" },
    ];
    let ranked = SearchEngineUI.filterResultsByRelevancy(results, "wandering inn");
    assert.equal(ranked.length, 1, "only the relevant title survives");
    assert.equal(ranked[0].title, "The Wandering Inn");
});

QUnit.test("filterResultsByRelevancy stopword-only query still matches", function (assert) {
    let results = [{ title: "The Return", url: "https://a.com/1" }];
    let ranked = SearchEngineUI.filterResultsByRelevancy(results, "the");
    assert.equal(ranked.length, 1, "query of only stopwords falls back to matching all tokens");
});

QUnit.test("filterResultsByRelevancy returns input for empty query", function (assert) {
    let results = [{ title: "Anything", url: "https://a.com/1" }];
    assert.equal(SearchEngineUI.filterResultsByRelevancy(results, "").length, 1);
    assert.equal(SearchEngineUI.filterResultsByRelevancy(results, "   ").length, 1);
});

QUnit.test("normalizeUrl strips www and trailing slash", function (assert) {
    assert.equal(SiteSearchEngine.normalizeUrl("https://www.novelfull.com/book/"), "novelfull.com/book");
    assert.equal(SiteSearchEngine.normalizeUrl("https://novelfull.com/book"), "novelfull.com/book");
});
