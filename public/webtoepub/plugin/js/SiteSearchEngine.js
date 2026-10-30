"use strict";

/* global HttpClient, AiClient, CompressionStream */
/* eslint-disable no-unused-vars */

/**
 * SiteSearchEngine - Custom search engine that queries novel sites directly.
 * 
 * Optimizations:
 *   - Races all proxies simultaneously (Promise.any) instead of sequential fallback
 *   - Strips <script>/<link>/<style> tags from proxied HTML to prevent resource loading
 *   - Caches site config arrays (no re-creation per call)
 *   - 6-second per-proxy timeout via AbortController
 *   - Caps results per site to 20 to prevent UI flooding
 *   - Progressive rendering via onResults callback
 */
class SiteSearchEngine {

    /** Max results to keep per individual site */
    static MAX_RESULTS_PER_SITE = 20;

    /** Timeout per proxy attempt in ms */
    static PROXY_TIMEOUT_MS = 4000;

    /**
     * The verified-working sites (2026-10-30 prune): search only covers sites
     * whose parsers were individually verified (TOC + chapter content).
     */
    static WORKING_HOSTS = new Set([
            "aerialrain.com",
            "akknovel.com",
            "alicesw.com",
            "asianhobbyist.com",
            "bakapervert.wordpress.com",
            "betwixtedbutterfly.com",
            "biquge.tw",
            "cclawtranslations.home.blog",
            "chosentwofanfic.com",
            "chyoa.com",
            "ckandawrites.online",
            "crescentmoon.blog",
            "crushnovelpo.blog",
            "czbooks.net",
            "dummynovels.com",
            "emberlib731.xyz",
            "exiledrebelsscanlations.com",
            "fanmtl.com",
            "fannovel.com",
            "fannovels.com",
            "fansmtl.com",
            "ffxs8.com",
            "flyonthewalls.blog",
            "freewebnovel.com",
            "goldennovel.com",
            "hiraethtranslation.com",
            "hoxionia.com",
            "hui3r.wordpress.com",
            "ilwxs.com",
            "indowebnovel.id",
            "indratranslations.com",
            "japtem.com",
            "jonaxxstories.com",
            "kakuyomu.jp",
            "karistudio.com",
            "lazygirltranslations.com",
            "leafstudio.site",
            "libread.com",
            "ln.hako.vn",
            "m.88xiaoshuo.net",
            "m.ilwxs.com",
            "m.metanovel.org",
            "m.sjks88.com",
            "m.tapas.io",
            "m.ttshu8.com",
            "m.xpaoshuba.com",
            "mydramanovel.com",
            "mznovels.com",
            "ncode.syosetu.com",
            "neobook.org",
            "nhvnovels.com",
            "nineheavens.org",
            "nobadnovel.com",
            "novel-bin.com",
            "novel-bin.net",
            "novel.naver.com",
            "novel543.com",
            "novelarrow.com",
            "noveldrama.org",
            "novelfire.net",
            "novelfull.com",
            "novelfull.net",
            "novelhi.com",
            "novelib.com",
            "novelingua.com",
            "novgo.me",
            "novgo.net",
            "nyantl.wordpress.com",
            "pandanovel.co",
            "peachpitting.com",
            "peachpuff.in",
            "piaotia.com",
            "powanjuan.cc",
            "ptwxz.com",
            "quanben.io",
            "quanben5.io",
            "questionablequesting.com",
            "ranobes.com",
            "readhive.org",
            "readingpia.me",
            "readnovelfull.com",
            "readwn.com",
            "rtd.moe",
            "rubymaybetranslations.com",
            "sasakitomyiano.wordpress.com",
            "scifistories.com",
            "scribblehub.com",
            "shalvationtranslations.wordpress.com",
            "shanghaifantasy.com",
            "shintranslations.com",
            "snoutandco.ca",
            "snowycodex.com",
            "snowytranslations.com",
            "sonicmtl.com",
            "storiesonline.net",
            "taffygirl13.wordpress.com",
            "teanovel.com",
            "tianyabooks.com",
            "tigertranslations.org",
            "timotxt.com",
            "tomotranslations.com",
            "translationchicken.com",
            "truyennhabo.com",
            "trxs.cc",
            "ttshu8.com",
            "twkan.com",
            "universalnovel.com",
            "unlimitednovelfailures.mangamatters.com",
            "velvet-reverie.org",
            "wanderertl130.id",
            "wanderinginn.com",
            "watashiwasugoidesu.com",
            "wattpad.com",
            "webnovel.com",
            "wetriedtls.com",
            "woopread.com",
            "wtnovels.com",
            "wuxia.city",
            "wuxia.click",
            "wuxiabox.com",
            "wuxiaspot.com",
            "wuxiaworld.com",
            "wuxiaworld.eu",
            "wuxiaworld.site",
            "xbanxia.cc",
            "xpaoshuba.com",
            "yeduge.com",
            "zhenhunxiaoshuo.com",
            "zirusmusings.net"
    ]);

    static _isWorkingHost(hostname) {
        let h = String(hostname || "").toLowerCase().replace(/^www\./, "");
        return SiteSearchEngine.WORKING_HOSTS.has(h);
    }

    // ─── Site Configurations (cached) ────────────────────────────────────

    static _primarySites = null;
    static _secondarySites = null;

    static get PRIMARY_SITES() {
        if (!SiteSearchEngine._primarySites) {
            SiteSearchEngine._primarySites = SiteSearchEngine._buildPrimarySites()
                .filter(s => SiteSearchEngine._isWorkingHost(s.hostname));
        }
        return SiteSearchEngine._primarySites;
    }

    static get SECONDARY_SITES() {
        if (!SiteSearchEngine._secondarySites) {
            SiteSearchEngine._secondarySites = SiteSearchEngine._buildSecondarySites()
                .filter(s => SiteSearchEngine._isWorkingHost(s.hostname));
        }
        return SiteSearchEngine._secondarySites;
    }

    static _buildPrimarySites() {
        return [
            {
                name: "NovelFull",
                hostname: "novelfull.net",
                searchUrl: (q) => `https://novelfull.net/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, "https://novelfull.net", "NovelFull (.net)")
            },
            {
                name: "NovelFull (.com)",
                hostname: "novelfull.com",
                searchUrl: (q) => `https://novelfull.com/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, "https://novelfull.com", "NovelFull (.com)")
            },
            {
                name: "FreeWebNovel",
                hostname: "freewebnovel.com",
                searchUrl: (q) => `https://freewebnovel.com/search`,
                getFetchOptions: (q) => ({
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `keyword=${encodeURIComponent(q)}`
                }),
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".li-row");
                    if (items.length === 0) items = dom.querySelectorAll(".col-content .li");
                    for (let item of items) {
                        let a = item.querySelector("h3.tit a") || item.querySelector(".tit a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".txt") || item.querySelector("p");
                            results.push({
                                title: (a.textContent.trim() || a.getAttribute("title") || a.title || "Untitled Novel").trim(),
                                url: SiteSearchEngine.resolveUrl("https://freewebnovel.com", a.getAttribute("href")),
                                snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                                source: "FreeWebNovel"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "NovelFire",
                hostname: "novelfire.net",
                searchUrl: (q) => `https://novelfire.net/search?keyword=${encodeURIComponent(q)}&type=title`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-item, .col-lg-6 a[href*='/book/']");
                    for (let item of items) {
                        let a = item.tagName === "A" ? item : item.querySelector("a[href*='/book/']");
                        let titleEl = item.querySelector(".novel-title, h4, h3");
                        if (a) {
                            results.push({
                                title: (titleEl ? titleEl.textContent : a.getAttribute("title") || a.textContent).trim(),
                                url: SiteSearchEngine.resolveUrl("https://novelfire.net", a.getAttribute("href")),
                                snippet: "",
                                source: "NovelFire"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "ScribbleHub",
                hostname: "scribblehub.com",
                searchUrl: (q) => `https://www.scribblehub.com/?s=${encodeURIComponent(q)}&post_type=fictionposts`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".search_main_box");
                    if (items.length === 0) items = dom.querySelectorAll(".search_body .search_row");
                    for (let item of items) {
                        let a = item.querySelector(".search_title a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".search_genre") || item.querySelector(".fdi");
                            results.push({
                                title: a.textContent.trim(),
                                url: a.href,
                                snippet: snippet ? snippet.textContent.trim() : "",
                                source: "ScribbleHub"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "WuxiaWorld",
                hostname: "wuxiaworld.com",
                searchUrl: (q) => `https://www.wuxiaworld.com/api/novels/search?query=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    try {
                        // linkedom and DOMParser might wrap JSON in <pre> or <body>
                        let content = dom.body ? dom.body.textContent : dom.textContent;
                        content = content.trim();
                        // Handle the case where the JSON is wrapped in a pre tag (common in browser auto-formatting)
                        if (content.startsWith("{") || content.startsWith("[")) {
                            let data = JSON.parse(content);
                            if (data && data.items) {
                                for (let item of data.items) {
                                    results.push({
                                        title: item.name,
                                        url: `https://www.wuxiaworld.com/novel/${item.slug}`,
                                        snippet: item.synopsis ? item.synopsis.replace(/<[^>]*>/g, "").substring(0, 150) : "",
                                        source: "WuxiaWorld"
                                    });
                                }
                                return results;
                            }
                        }
                    } catch (e) {
                        console.warn("[SiteSearch] WuxiaWorld JSON parse failed, falling back to HTML.", e);
                    }

                    // Fallback to HTML parsing
                    let items = dom.querySelectorAll(".novel-item, .MuiGrid-item, article, [class*='NovelItem']");
                    for (let item of items) {
                        let a = item.querySelector("a[href*='/novel/']") || item.querySelector("a");
                        if (a) {
                            let titleEl = item.querySelector("h4, h3, .novel-title, [class*='Title']") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://www.wuxiaworld.com", a.getAttribute("href")),
                                snippet: "",
                                source: "WuxiaWorld"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "BoxNovel",
                hostname: "novgo.net",
                searchUrl: (q) => `https://novgo.net/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".list-novel .novel-item, .update-item, .novel-item, .post-item, .li-row");
                    for (let item of items) {
                        let a = item.querySelector("h3 a, .novel-title a, .post-title a, a[title], a");
                        if (a) {
                            results.push({
                                title: (a.getAttribute("title") || a.textContent).trim(),
                                url: SiteSearchEngine.resolveUrl("https://novgo.net", a.getAttribute("href")),
                                snippet: "",
                                source: "BoxNovel"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "Readwn",
                hostname: "wuxiabox.com",
                searchUrl: (q) => `https://www.wuxiabox.com/search.html?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".row .col-md-3, .novel-item, .post-item, a[href*='/novel/']");
                    for (let item of items) {
                        let a = item.tagName === "A" ? item : item.querySelector("h4 a, a[title], a");
                        if (a && a.getAttribute("href")) {
                            let titleEl = item.querySelector("h4, .title") || a;
                            results.push({
                                title: a.getAttribute("title") || titleEl.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://www.wuxiabox.com", a.getAttribute("href")),
                                snippet: "",
                                source: "Readwn"
                            });
                        }
                    }
                    return results;
                }
            },

        ];
    }

    static _buildSecondarySites() {
        let sites = [
            {
                name: "FanFiction.net",
                hostname: "www.fanfiction.net",
                searchUrl: (q) => `https://www.fanfiction.net/search/?keywords=${encodeURIComponent(q)}&type=story`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".z-list");
                    for (let item of items) {
                        let a = item.querySelector("a.stitle");
                        if (a && a.href) {
                            let snippet = item.querySelector(".z-indent .z-padtop") || item.querySelector(".z-padtop");
                            results.push({
                                title: a.textContent.trim(),
                                url: a.href,
                                snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                                source: "FanFiction.net"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "ReadNovelFull",
                hostname: "readnovelfull.com",
                searchUrl: (q) => `https://readnovelfull.com/novel-list/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, "https://readnovelfull.com", "ReadNovelFull")
            }
        ];

        // Categorized batch addition for the ~500 sites
        SiteSearchEngine._addEngineSites(sites);

        return sites;
    }

    // ─── Shared Parsers & Helpers ────────────────────────────────────────

    static _addEngineSites(sites) {
        const existingHosts = new Set([
            ...SiteSearchEngine.PRIMARY_SITES.map(s => s.hostname.toLowerCase()),
            ...sites.map(s => s.hostname.toLowerCase())
        ]);

        const addIfNew = (h, config) => {
            if (!SiteSearchEngine._isWorkingHost(h)) return;
            let lh = h.toLowerCase();
            if (!existingHosts.has(lh)) {
                existingHosts.add(lh);
                sites.push(config);
            }
        };

        // NovelFull Engine
        const novelFullHosts = ["all-novelfull.net","allnovel.org","allnovelfull.com","allnovelfull.net","allnovelnext.com","boxnovel.org","fastnovel.net","novel-bin.com","novel-bin.net","novelbin.net","noveldrama.org","novelfull.com","novelfull.net","novelgate.net","novelgreat.net","novelmax.net","novelnext.com","novelnext.net","novelnextz.com","novelonlinefree.info","noveltop1.org","novgo.net","novlove.com","readnovelfull.me","thenovelbin.org","topnovelfull.com","wuxia-world.online","novelnice.com","novgo.me",];
        for (let h of novelFullHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, `https://${h}`, h)
            });
        }

        // Indra Translations (custom theme, not Madara): its series
        // search lives at /series/?keyword= and results are .series-card
        // elements whose URL is in the card's onclick (no anchor tags).
        // The old Madara route (/?s=&post_type=wp-manga) returns "No
        // results" for every query, so the AI fallback invented results
        // from the nav/promo links instead — the false search results.
        addIfNew("indratranslations.com", {
            name: "indratranslations.com", hostname: "indratranslations.com",
            searchUrl: (q) => `https://indratranslations.com/series/?keyword=${encodeURIComponent(q)}`,
            parseResults: (dom) => SiteSearchEngine.parseIndratranslationsStyle(dom, "https://indratranslations.com", "indratranslations.com")
        });

        // Madara Engine
        const madaraHosts = ["greenztl2.com","kdtnovels.com","mangaread.co","mangasushi.net","manhwaden.com","manhwatop.com","readwebnovel.xyz","vipnovel.com","wuxiaworld.site","hiraethtranslation.com","novelmic.com","sonicmtl.com","zetrotranslation.com","crescentmoon.blog",];
        for (let h of madaraHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/?s=${encodeURIComponent(q)}&post_type=wp-manga`,
                parseResults: (dom) => SiteSearchEngine.parseMadaraStyle(dom, `https://${h}`, h)
            });
        }

        // Readwn Engine
        const readwnHosts = ["fanmtl.com","fannovel.com","fannovels.com","fansmtl.com","novellive.app","novellive.com","novellive.net","novelmtl.com","readwn.com","readwn.org","wuxiafox.com","wuxiamtl.com","wuxiapub.com","wuxiaspot.com"];
        for (let h of readwnHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/search.html?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseReadwnStyle(dom, `https://${h}`, h)
            });
        }

        // Wordpress Engine
        const wpHosts = ["aerialrain.com","asianhobbyist.com","bakapervert.wordpress.com","bookswithqianya.com","cangji.net","cclawtranslations.home.blog","cherrymist.cafe","chickengege.org","chrysanthemumgarden.com","ckandawrites.online","creativenovels.com","crimsonmagic.me","cyborg-tl.com","dasuitl.com","emberlib731.xyz","exiledrebelsscanlations.com","flyonthewalls.blog","frostfire10.wordpress.com","gravitynovels.com","gravitytales.com","hiscension.com","hui3r.wordpress.com","isekaicyborg.wordpress.com","jonaxxstories.com","knoxt.space","lazygirltranslations.com","lightnovelfr.com","lightnovelstranslations.com","lilyonthevalley.com","lorenovels.com","midnightrambles.in","moonbunnycafe.com","my-novel.online","nhvnovels.com","novelhall.com","novelib.com","novelingua.com","novelmao.com","novelsknight.punchmanga.online","novelversetranslations.com","nyantl.wordpress.com","ontimestory.eu","pienovels.com","re-library.com","requiemtls.com","rtenzo.net","rubymaybetranslations.com","sasakitomyiano.wordpress.com","secondlifetranslations.com","shalvationtranslations.wordpress.com","shinningnoveltranslations.com","shinsori.com","shmtranslations.com","snowycodex.com","soafp.com","soverse.com","springofromance.com","taffygirl13.wordpress.com","translationchicken.com","unlimitednovelfailures.mangamatters.com","wanderertl130.id","wanderinginn.com","whitemoonlightnovels.com","wtnovels.com","xiaxuenovels.xyz","zenithnovels.com","nocturnetranslations.com","snowytranslations.com",];
        for (let h of wpHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/?s=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseWordpressStyle(dom, `https://${h}`, h)
            });
        }

        // Noblemtl Engine
        const nobleHosts = ["arcanetranslations.com","daotranslate.com","faloomtl.com","genesistls.com","hoxionia.com","jobnib.com","noblemtl.com","novelsknight.com","novelsparadise.net","readfreebooksonline.org","universalnovel.com"];
        for (let h of nobleHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/?s=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNoblemtlStyle(dom, `https://${h}`, h)
            });
        }

        // LightNovelWorld Engine
        const lnwHosts = ["findnovel.net","lightnovelcave.com","lightnovelpub.com","lightnovelworld.co","lightnovelworld.com","novelbob.org","novelfire.docsachhay.net","novelfire.net","novelpub.com","pandanovel.co","webnovelpub.com"];
        for (let h of lnwHosts) {
            addIfNew(h, {
                name: h, hostname: h,
                searchUrl: (q) => `https://${h}/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseLightNovelWorldStyle(dom, `https://${h}`, h)
            });
        }

        // General / Other Sites (~400 sites)
        const generalHosts = ["230book.net","38xs.com","69shuba.tw","88xiaoshuo.net","aerialrain.com","alicesw.com","alphapolis.co.jp","alternatehistory.com","api.mangadex.org","app.yoru.world","asianfanfics.com","asianhobbyist.com","asianovel.net","b.faloo.com","babelnovel.com","baka-tsuki.org","bednovel.com","betwixtedbutterfly.com","biquge.tw","book18.org","bookswithqianya.com","botitranslation.com","boxnovel.net","boylove.cc","brightnovels.com","brittanypage43.com","buntls.com","cangji.net","cherrymist.cafe","chickengege.org","chosentwofanfic.com","chrysanthemumgarden.com","chyoa.com","ckandawrites.online","comics.8muses.com","creativenovels.com","crimsontranslations.com","crushnovelpo.blog","cyborg-tl.com","czbooks.net","dao-divine-tl.com","dark-novels.ru","dasuitl.com","ddxs.com","deviantart.com","dummynovels.com","edanglarstranslations.com","emberlib731.xyz","empirenovel.com","erofus.com","estar.jp","exiledrebelsscanlations.com","fanfiction.com.br","fanfictionero.com","fanficus.com","fastnovel.net","fenrirealm.com","ffxs8.com","fic.fan","ficador.com","ficbook.net","fictionhunt.com","fictionmania.tv","fictionzone.net","ficwad.com","fimfiction.net","findnovel.net","finestories.com","flying-lines.com","flyonthewalls.blog","forum.questionablequesting.com","forums.nrvnqsr.com","forums.spacebattles.com","forums.sufficientvelocity.com","foxteller.com","freewebnovel.com","fuhuzz.pro","gamefaqs.gamespot.com","genesistudio.com","global.novelpia.com","goldennovel.com","goodnovel.com","graverobbertl.site","gravitynovels.com","gravitytales.com","gunnerkrigg.com","gutenberg.spiegel.de","helioscans.com","hentai-foundry.com","hiscension.com","hostednovel.com","hui3r.wordpress.com","idleturtle-translations.com","ilwxs.com","imgur.com","indowebnovel.id","indratranslations.com","inkitt.com","inoveltranslation.com","isotls.com","ixdzs.tw","ixdzs8.com","jadescrolls.com","japtem.com","jjwxc.net","jonaxxstories.com","jpmtl.com","kakuyomu.jp","karistudio.com","kaystls.site","kdtnovels.com","knoxt.space","ko-fi.com","lanry.space","lazygirltranslations.com","leafstudio.site","libread.com","libri7.com","lightnovelasia.com","lightnovelfr.com","lightnovels.live","lightnovelstranslations.com","lilyonthevalley.com","literotica.com","lnmtl.com","lorenovels.com","m.38xs.com","m.88xiaoshuo.net","m.bqg225.com","m.ilwxs.com","m.metanovel.org","m.qbxsw.com","m.shuhaige.net","m.sjks88.com","m.tapas.io","m.ttshu8.com","m.xpaoshuba.com","madnovel.com","magic.wizards.com","mangadex.org","mangakakalot.com","manganelo.com","mangaread.co","manhwaden.com","marx2mao.com","marxists.org","mcstories.com","meionovel.id","midnightrambles.in","mimihui.com","mistminthaven.com","moonquill.com","mottruyen.vn","mvlempyr.com","mvlempyr.io","my-novel.online","mydramanovel.com","mystorywave.com","myxls.net","mznovels.com","nanomashin.online","ncode.syosetu.com","neobook.org","nhvnovels.com","nineheavens.org","nobadnovel.com","novel.babelchain.org","novel.naver.com","novel18.syosetu.com","novel543.com","novelbuddy.com","novelbuddy.io","novelcool.com","novelebook.com","novelfever.com","novelfire.net","novelgate.net","novelgo.id","novelgreat.net","novelhall.com","novelhi.com","novelib.com","novelight.net","novelingua.com","novellive.app","novellive.com","novellive.net","novelmania.com.br","novelmao.com","novelmedium.com","novelonlinefree.info","novelonomicon.com","novelpassion.com","novels.pl","novelsect.com","novelshub.org","novelsknight.punchmanga.online","novelsonline.net","novelsonline.org","novelsquare.blog","noveltoon.mobi","novelupdates.cc","novelupdates.com","novelversetranslations.com","ntruyen.vn","nyantl.wordpress.com","old.ranobelib.me","ontimestory.eu","panda-novel.com","pandasnovel.com","patreon.com","pawread.com","peachblossomcodex.com","peachpitting.com","peachpuff.in","peachygardens.blogspot.com","piaotia.com","pienovels.com","pindangscans.com","powanjuan.cc","puretl.com","qbxsw.com","quanben.io","quanben5.io","queenrosenovel.blogspot.com","questionablequesting.com","quotev.com","rainofsnow.com","randomtranslator.com","ranobelib.me","ranobes.com","ranobes.net","ranobes.top","re-library.com","readernovel.net","readhive.org","readingpia.me","readlightnovel.cc","readnovelfull.org","readnovelmtl.com","readwn.org","reddit.com","requiemtls.com","royalroad.com","royalroadl.com","rtd.moe","rtenzo.net","rubymaybetranslations.com","ruvers.ru","sangtacviet.com","sangtacviet.vip","scifistories.com","scribblehub.com","secondlifetranslations.com","semprot.com","sexstories.com","shanghaifantasy.com","shikkakutranslations.org","shinningnoveltranslations.com","shinsori.com","shintranslations.com","shmtranslations.com","shubaow.net","shubaowb.com","shuhaige.net","sites.google.com","sjks88.com","skydemonorder.com","snoutandco.ca","snowycodex.com","soafp.com","sonako.fandom.com","sonako.wikia.com","soverse.com","spiritfanfiction.com","springofromance.com","sspai.com","starlightstream.net","storiesonline.net","storyseedling.com","taffygirl13.wordpress.com","tapas.io","tapread.com","teanovel.com","teenfic.net","tigertranslations.org","timotxt.com","tl.rulate.ru","toctruyen.net","tomotranslations.com","tongrenshe.cc","translationchicken.com","truyenfull.vision","truyenfull.vn","truyennhabo.com","truyenyy.com","trxs.cc","trxs.me","ttshu8.com","twkan.com","uaa.com","velvet-reverie.org","volarenovels.com","vynovel.com","wanderertl130.id","wanderinginn.com","watashiwasugoidesu.com","wattpad.com","wattpad.com.vn","webnovel.com","webnovelonline.com","wenku8.net","wetriedtls.com","wfxs.tw","whitemoonlightnovels.com","wnmtl.com","wnmtl.org","woopread.com","wordexcerpt.com","wtnovels.com","wtr-lab.com","wuxia-world.online","wuxia.city","wuxia.click","wuxiaworld.com","wuxiaworld.eu","www.8muses.com","www.dudushuge.com","www.fanfiction.net","www.fictionpress.com","www.mangahere.cc","wxscs.com","xbanxia.cc","xiaoshubao.net","xiaxuenovels.xyz","xpaoshuba.com","yeduge.com","zenithnovels.com","zenithtls.com","zeonic-republic.net","zhenhunxiaoshuo.com","zirusmusings.net","asuracomic.net","bixiange.me","fictionlog.co","novelhold.com","novelmt.com","ptwxz.com","69shuba.com","uukanshu.com","webnovelworld.org","novelbuddy.me",];
        for (let h of generalHosts) {
            let searchUrl = (q) => `https://${h}/?s=${encodeURIComponent(q)}`;
            let getFetchOptions = null;
            let parseResults = (dom) => SiteSearchEngine.parseWordpressStyle(dom, `https://${h}`, h);

            if (h.includes("wattpad.com")) {
                searchUrl = (q) => `https://www.wattpad.com/search/${encodeURIComponent(q)}`;
            } else if (h.includes("syosetu.com")) {
                searchUrl = (q) => `https://syosetu.com/search/search/?word=${encodeURIComponent(q)}`;
            } else if (h.includes("69shu")) {
                searchUrl = () => `https://${h}/modules/article/search.php`;
                getFetchOptions = (q) => {
                    return {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: `searchkey=${encodeURIComponent(q)}`
                    };
                };
            } else if (h.includes("czbooks.net")) {
                searchUrl = (q) => `https://czbooks.net/s/${encodeURIComponent(q)}`;
            } else if (h.includes("chyoa.com")) {
                searchUrl = (q) => `https://chyoa.com/search?q=${encodeURIComponent(q)}`;
                parseResults = (dom) => SiteSearchEngine.parseChyoaStyle(dom, `https://chyoa.com`, h);
            } else if (h.includes("webnovel.com")) {
                searchUrl = (q) => `https://www.webnovel.com/search?keywords=${encodeURIComponent(q)}`;
                parseResults = (dom) => SiteSearchEngine.parseWebNovelStyle(dom, `https://www.webnovel.com`, h);
            } else if (h.includes("ranobes.")) {
                searchUrl = (q) => `https://${h}/index.php?do=search&subaction=search&story=${encodeURIComponent(q)}`;
            }

            addIfNew(h, {
                name: h, hostname: h,
                searchUrl,
                ...(getFetchOptions ? { getFetchOptions } : {}),
                parseResults
            });
        }
    }

    static parseNovelFullStyle(dom, baseUrl, sourceName) {
        let results = [];
        // .li-row is the current novelfull.net search layout; #results-grid
        // cards are novel-bin's layout (the card itself is the anchor, its
        // title lives in h3 or the title attribute, not the full card text
        // which also carries author/view counts).
        // Scope to the main results column when the theme has one: the
        // .list-truyen selector also matches the Genres sidebar and the
        // "Top novels" sidebar, whose links otherwise leak in as results
        // whenever the real result list is empty ("No results" pages).
        let scope = dom.querySelector(".col-truyen-main") || dom;
        let items = scope.querySelectorAll(".list-truyen .row, .archive .list-truyen-item-wrap, .list .row, .li-row, #results-grid a.nl2-book-card");
        const inSidebar = (el) => {
            let p = el;
            while (p) {
                let c = String((p.className && p.className.baseVal !== undefined) ? p.className.baseVal : (p.className || ""));
                if (/(^|\s)(list-cat|list-side|col-truyen-side|top-item|sidebar)(\s|$)/.test(c)) return true;
                p = p.parentElement;
            }
            return false;
        };
        for (let item of items) {
            if (inSidebar(item)) continue;
            let a = item.tagName === "A" ? item : item.querySelector(".truyen-title a, h3 a, a");
            if (a && a.getAttribute("href")) {
                let titleEl = item.querySelector("h3, .truyen-title");
                let title = (titleEl ? titleEl.textContent : "") || a.getAttribute("title") || a.textContent;
                title = title.trim();
                let url = SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href"));
                // The .list-truyen selector also matches the Genres sidebar
                // (.list-cat rows); those links are genre archives, not
                // novels, and must never surface as search results.
                if (SiteSearchEngine.isJunkResultUrl(url)) continue;
                let snippet = item.querySelector(".text-primary, .author");
                results.push({
                    title,
                    url,
                    snippet: snippet ? snippet.textContent.trim() : "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    // Archive/utility URLs that can never be a novel page: genre, category,
    // author and tag archives, site home/search pages, and Cloudflare's
    // email-protection links (which the parsers otherwise pick up as results).
    static isJunkResultUrl(url) {
        try {
            let u = new URL(url);
            let path = u.pathname.toLowerCase();
            if (url.includes("cdn-cgi/")) return true;
            if (path === "/" || path === "/home" || path === "/home/" || path === "/search" || path === "/search/" || path === "/series" || path === "/series/") return true;
            return /^\/(genre|genres|category|categories|author|authors|tag|tags)\//.test(path);
        } catch (e) {
            return false;
        }
    }

    static parseIndratranslationsStyle(dom, baseUrl, sourceName) {
        let results = [];
        // Scoped to the results container so featured/promo cards
        // elsewhere on the page can never surface as results.
        let items = dom.querySelectorAll("#series-results-container .series-card");
        for (let item of items) {
            let titleEl = item.querySelector(".series-card-title");
            let title = titleEl ? titleEl.textContent.trim() : "";
            let url = "";
            let onclick = item.getAttribute("onclick") || "";
            let m = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (m) {
                url = m[1];
            } else {
                let a = item.querySelector("a");
                if (a && a.getAttribute("href")) {
                    url = a.getAttribute("href");
                }
            }
            if (title && url) {
                results.push({
                    title,
                    url: SiteSearchEngine.resolveUrl(baseUrl, url),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static parseMadaraStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".c-tabs-item__content, .search-wrap .manga-item, .manga-item");
        for (let item of items) {
            // Prefer the title anchor: the first anchor in a card is often a
            // status/rank/cover link whose text ("New chapter", "1") is not
            // the novel title.
            let a = item.querySelector(".post-title a, h3 a") || item.querySelector("a");
            if (a && a.href) {
                let snippet = item.querySelector(".summary__content, .excerpt, .summary");
                results.push({
                    title: a.textContent.trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: snippet ? snippet.textContent.trim() : "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static parseWordpressStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll("article, .post-item, .latest-post, .entry, .flexbox2-item");
        for (let item of items) {
            let a = item.querySelector(".entry-title a, .post-title a, h2 a") || item.querySelector("a");
            if (a && a.href) {
                let snippet = item.querySelector(".entry-summary, .post-excerpt, p");
                // flexbox2 grid themes (e.g. indowebnovel) put the clean
                // title in the first span of .flexbox2-title; the link's
                // own text would concatenate title + studio tag.
                let title = item.querySelector(".flexbox2-title span")?.textContent?.trim()
                    || a.textContent.trim();
                results.push({
                    title: title,
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static parseReadwnStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".novels-list li, .chapter-list li, .list-chapter li, li");
        for (let item of items) {
            let a = item.querySelector("a");
            if (a && a.href && (a.href.includes("/novel/") || a.href.includes("/book/"))) {
                let title = item.querySelector(".novel-title, h4, .title") || a;
                results.push({
                    title: title.textContent.trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static parseNoblemtlStyle(dom, baseUrl, sourceName) {
        // Similar to Madara/WP but tailored
        let results = [];
        let items = dom.querySelectorAll(".bs, .listupd .bs, article");
        for (let item of items) {
            let a = item.querySelector("a");
            if (a && a.href) {
                let title = item.querySelector(".tt, h2, h3, .title") || a;
                results.push({
                    title: title.textContent.trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    // CHYOA renders real search results server-side in
    // ol.rd-search-results > li.rd-search-results__item, title in h3 a.
    // (Its generic WordPress route /?s= just returns the story index.)
    static parseChyoaStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".rd-search-results__item, .rd-search-results li");
        for (let item of items) {
            // The cover anchor comes first in the item and has no text; the
            // title lives in the h3 anchor, so it must win.
            let a = item.querySelector("h3 a") || item.querySelector("a");
            if (a && a.getAttribute("href")) {
                results.push({
                    title: (a.getAttribute("title") || a.textContent).trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    // WebNovel renders results server-side: .j_result_wrap li items, the
    // title link is the h3 anchor (title attribute = novel title).
    static parseWebNovelStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".j_result_wrap li, .search-result-container li");
        for (let item of items) {
            let a = item.querySelector("h3 a, a[title]");
            if (a && a.getAttribute("href")) {
                results.push({
                    title: (a.getAttribute("title") || a.textContent).trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static parseLightNovelWorldStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".novel-item, .search-item, .novel-entry");
        for (let item of items) {
            let a = item.querySelector("a[href*='/novel/'], a");
            if (a && a.href) {
                let titleEl = item.querySelector("h4, h3, .novel-title, .title") || a;
                results.push({
                    title: titleEl.textContent.trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static resolveUrl(base, href) {
        if (!href) return base;
        if (href.startsWith("http://") || href.startsWith("https://")) return href;
        try {
            return new URL(href, base).href;
        } catch (e) {
            return base + (href.startsWith("/") ? "" : "/") + href;
        }
    }

    // ─── Network Layer ───────────────────────────────────────────────────

    /**
     * Parse HTML into a safe DOM — removes resource-loading elements
     * (script, link, style, iframe, img) and sets a <base> tag for relative
     * URL resolution. Faster than running giant regex on raw HTML strings.
     */
    static parseSafeHtml(html, baseUrl) {
        if (!html) html = "<html><body></body></html>";
        // Strip speculative preload tags to prevent relative asset fetches through proxies
        html = html.replace(/<link\s+[^>]*?rel=["']preload["'][^>]*?>/gi, "");
        let dom;
        try {
            dom = new DOMParser().parseFromString(html, "text/html");
            if (!dom || !dom.documentElement) {
                dom = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
            }
        } catch (e) {
            dom = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
        }
        for (let el of dom.querySelectorAll("script, link, style, iframe, img")) {
            el.remove();
        }
        let base = dom.createElement("base");
        base.href = baseUrl;
        if (dom.head) {
            dom.head.appendChild(base);
        } else if (dom.documentElement) {
            dom.documentElement.appendChild(base);
        }
        return dom;
    }

    /**
     * Race all proxies simultaneously — return HTML from the first one that responds.
     * Falls back gracefully if all fail (returns null).
     */
    static async fetchViaProxy(url, fetchOptions = {}) {
        let proxies = (typeof HttpClient !== "undefined" && HttpClient.CORS_PROXIES)
            ? HttpClient.CORS_PROXIES
            : [];

        if (proxies.length === 0) return null;

        // Build one racing promise per proxy
        let proxyPromises = proxies.map(proxy => {
            let controller = new AbortController();
            let timeoutId = setTimeout(() => controller.abort(), SiteSearchEngine.PROXY_TIMEOUT_MS);
            let fetchUrl = proxy.url + encodeURIComponent(url);

            let finalOptions = Object.assign({ credentials: "omit", signal: controller.signal }, fetchOptions);

            return fetch(fetchUrl, finalOptions)
                .then(async (response) => {
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    let text = await response.text();
                    if (!text || text.length < 200) {
                        throw new Error("Empty or too short response");
                    }
                    let lower = text.toLowerCase();
                    const isCfBlock = lower.includes("window._cf_chl_opt") ||
                        lower.includes("cf-challenge-") ||
                        lower.includes("cf-browser-verification") ||
                        (lower.includes("cloudflare") && (
                            lower.includes("<title>just a moment...</title>") ||
                            lower.includes("<title>attention required") ||
                            lower.includes("please complete the security check") ||
                            lower.includes("checking your browser before accessing") ||
                            lower.includes("enable javascript and cookies") ||
                            (lower.includes("access denied") && (lower.includes("ray id") || lower.includes("error 10") || lower.includes("error 403")))
                        ));
                    if (isCfBlock) {
                        throw new Error("Cloudflare block page");
                    }
                    if (typeof process !== "undefined" && process.env.DEBUG) {
                        console.log(`    [Proxy Debug] ${proxy.name} succeeded: ${text.length} chars`);
                    }
                    return text;
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    if (typeof process !== "undefined" && process.env.DEBUG) {
                        console.log(`    [Proxy Debug] ${proxy.name} failed: ${err.message} (${err.name})`);
                    }
                    throw err; // rethrow so Promise.any skips this one
                });
        });

        try {
            // Promise.any resolves with the FIRST successful promise
            return await Promise.any(proxyPromises);
        } catch (e) {
            // AggregateError — all proxies failed
            return null;
        }
    }

    /**
     * Fetch, sanitize, parse a single site's search results.
     */
    static async fetchSiteResults(site, query) {
        try {
            let url = site.searchUrl(query);
            let fetchOptions = site.getFetchOptions ? await site.getFetchOptions(query) : {};
            let html = await SiteSearchEngine.fetchViaProxy(url, fetchOptions);

            if (!html) {
                return [];
            }

            // Parse safely: strips resource-loading elements and sets base URL in one pass
            let dom = SiteSearchEngine.parseSafeHtml(html, url);

            let results = site.parseResults(dom);

            // AI Fallback if no results and AI query is configured (or as general fallback)
            if (results.length === 0 && typeof AiClient !== "undefined") {
                results = await AiClient.fetchAiResults(html, query, url);
            }

            // Drop utility/archive links every parser can pick up (genre and
            // category sidebars, author/tag archives, home/search links,
            // email-protection links) and empty/ellipsis titles.
            results = results.filter(r =>
                r && r.url && r.title && r.title.trim() && r.title.trim() !== "\u2026" &&
                r.title.trim().toLowerCase() !== "new chapter" &&
                r.title.trim().toLowerCase() !== "new chapters" &&
                !SiteSearchEngine.isJunkResultUrl(r.url));

            // Cap per-site results
            if (results.length > SiteSearchEngine.MAX_RESULTS_PER_SITE) {
                results = results.slice(0, SiteSearchEngine.MAX_RESULTS_PER_SITE);
            }
            return results;
        } catch (error) {
            console.warn(`[SiteSearch] Error on ${site.name}:`, error.message);
            return [];
        }
    }

    // ─── Search Orchestrator ─────────────────────────────────────────────

    /**
     * Search sites incrementally until targetResultCount is reached or all sites are exhausted.
     *
     * @param {string} query
     * @param {number} startIndex - Index in the sites array to start from.
     * @param {number} targetResultCount - Number of NEW results to find before stopping.
     * @param {boolean} includeSecondary
     * @param {function} onProgress - (siteName, status) => void
     * @param {function} onResults - (newResults) => void
     * @returns {Promise<{results: Array, nextIndex: number}>}
     */
    static async search(query, startIndex = 0, targetResultCount = 10, includeSecondary = false, onProgress, onResults) {
        let sites = [...SiteSearchEngine.PRIMARY_SITES];
        if (includeSecondary) {
            sites = sites.concat(SiteSearchEngine.SECONDARY_SITES);
        }

        if (onProgress && startIndex === 0) {
            onProgress("Starting", `Searching ${sites.length} sites...`);
        }

        let results = [];
        let seenUrls = new Set();
        let currentIndex = startIndex;

        // Search all sites in parallel for maximum speed.
        // Proxy racing inside fetchViaProxy handles per-site failures/timeouts.
        const BATCH_SIZE = 1000; 


        while (currentIndex < sites.length) {
            let batch = sites.slice(currentIndex, currentIndex + BATCH_SIZE);
            let promises = batch.map(async (site) => {
                if (onProgress) onProgress(site.name, "searching");
                let siteResults = await SiteSearchEngine.fetchSiteResults(site, query);
                if (onProgress) onProgress(site.name, `found ${siteResults.length}`);
                return siteResults;
            });

            let batchResults = await Promise.all(promises);
            let newResultsFound = [];
            for (let siteResults of batchResults) {
                for (let r of siteResults) {
                    let key = SiteSearchEngine.normalizeUrl(r.url);
                    if (!seenUrls.has(key)) {
                        seenUrls.add(key);
                        results.push(r);
                        newResultsFound.push(r);
                    }
                }
            }

            if (newResultsFound.length > 0 && onResults) {
                onResults(newResultsFound);
            }

            currentIndex += batch.length;

            let sitesProcessedSoFar = currentIndex - startIndex;
            // Stop early if we have enough results.
            if (results.length >= targetResultCount) break;

        }

        return {
            results: results.slice(0, targetResultCount),
            nextIndex: currentIndex < sites.length ? currentIndex : -1
        };
    }

    // ─── Utilities ───────────────────────────────────────────────────────

    static normalizeUrl(url) {
        try {
            let u = new URL(url);
            return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
        } catch (e) {
            return url;
        }
    }

    static getAllSiteNames() {
        let primary = SiteSearchEngine.PRIMARY_SITES.map(s => ({ name: s.name, primary: true }));
        let secondary = SiteSearchEngine.SECONDARY_SITES.map(s => ({ name: s.name, primary: false }));
        return [...primary, ...secondary];
    }
}
