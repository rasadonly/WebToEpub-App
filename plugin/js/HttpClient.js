/*
  Makes HTML calls using Fetch API
*/
"use strict";

class FetchErrorHandler {
    constructor() {
    }

    makeFailMessage(url, error) {
        return UIText.Error.htmlFetchFailed(url, error);
    }

    makeFailCanRetryMessage(url, error) {
        return this.makeFailMessage(url, error) + " " +
            UIText.Warning.httpFetchCanRetry;
    }

    getCancelButtonText() {
        return UIText.Common.cancel;
    }

    static cancelButtonText() {
        return UIText.Common.cancel;
    }

    onFetchError(url, error) {
        return Promise.reject(new Error(this.makeFailMessage(url, error.message)));
    }

    onResponseError(url, wrapOptions, response, errorMessage) {
        let failError;
        if (errorMessage) {
            failError = new Error(errorMessage);
        } else {
            failError = new Error(this.makeFailMessage(response.url, response.status));
        }
        let retry = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(response);
        if (retry.retryDelay.length === 0) {
            return Promise.reject(failError);
        }

        if (wrapOptions.retry === undefined) {
            wrapOptions.retry = retry;
            return this.retryFetch(url, wrapOptions);
        }

        if (0 < wrapOptions.retry.retryDelay.length) {
            return this.retryFetch(url, wrapOptions);
        }

        if (wrapOptions.retry.promptUser) {
            return this.promptUserForRetry(url, wrapOptions, response, failError);
        } else {
            return Promise.reject(failError);
        }
    }

    promptUserForRetry(url, wrapOptions, response, failError) {
        let msg;
        if (wrapOptions.retry.HTTP === 403) {
            msg = new Error(UIText.Warning.warning403ErrorResponse(new URL(response.url).hostname) + this.makeFailCanRetryMessage(url, response.status));
        } else {
            msg = new Error(new Error(this.makeFailCanRetryMessage(url, response.status)));
        }
        let cancelLabel = this.getCancelButtonText();
        return new Promise((resolve, reject) => {
            if (wrapOptions.retry.HTTP === 403) {
                msg.openurl = response.url;
                msg.blockurl = url;
            }
            msg.retryAction = () => resolve(HttpClient.wrapFetchImpl(url, wrapOptions));
            msg.cancelAction = () => reject(failError);
            msg.cancelLabel = cancelLabel;
            ErrorLog.showErrorMessage(msg);
        });
    }

    async retryFetch(url, wrapOptions) {
        let delayBeforeRetry = wrapOptions.retry.retryDelay.pop() * 1000;
        await util.sleep(delayBeforeRetry);
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static getAutomaticRetryBehaviourForStatus(response) {
        // seconds to wait before each retry (note: order is reversed)
        let retryDelay = [120, 60, 30, 15];
        switch (response.status) {
            case 403:
                return { retryDelay: [1], promptUser: true, HTTP: 403 };
            case 429:
                FetchErrorHandler.show429Error(response);
                return { retryDelay: retryDelay, promptUser: true };
            case 445:
                //Random Unique exception thrown on Webnovel/Qidian. Not part of w3 spec.
                return { retryDelay: retryDelay, promptUser: false };
            case 509:
                // server asked for rate limiting
                return { retryDelay: retryDelay, promptUser: true };
            case 500:
                // is fault at server, retry might clear
                return { retryDelay: retryDelay, promptUser: false };
            case 502:
            case 503:
            case 504:
            case 520:
            case 522:
                // intermittant fault
                return { retryDelay: retryDelay, promptUser: true };
            case 524:
                // claudflare random error
                return { retryDelay: [1], promptUser: true };
            case 999:
                // custom WebToEpub error (some api's fail and a few seconds later it is a success)
                return { retryDelay: response.retryDelay, promptUser: false };
            default:
                // it's dead Jim
                return { retryDelay: [], promptUser: false };
        }
    }

    static show429Error(response) {
        let host = new URL(response.url).hostname;
        if (!FetchErrorHandler.rateLimitedHosts.has(host)) {
            FetchErrorHandler.rateLimitedHosts.add(host);
            alert(UIText.Warning.warning429ErrorResponse(host));
        }
    }
}
FetchErrorHandler.rateLimitedHosts = new Set();

class FetchImageErrorHandler extends FetchErrorHandler { // eslint-disable-line no-unused-vars
    constructor(parentPageUrl) {
        super();
        this.parentPageUrl = parentPageUrl;
    }

    makeFailMessage(url, error) {
        return UIText.Error.imageFetchFailed(url, this.parentPageUrl, error);
    }

    getCancelButtonText() {
        return UIText.Common.skip;
    }
}

class HttpClient {
    constructor() {
    }

    static makeOptions() {
        return { credentials: "include" };
    }

    static wrapFetch(url, wrapOptions) {
        if (wrapOptions == null) {
            wrapOptions = {
                errorHandler: new FetchErrorHandler()
            };
        }
        if (wrapOptions.errorHandler == null) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }
        wrapOptions.responseHandler = new FetchResponseHandler();
        if (wrapOptions.makeTextDecoder != null) {
            wrapOptions.responseHandler.makeTextDecoder = wrapOptions.makeTextDecoder;
        }
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchHtml(url) {
        let wrapOptions = {
            responseHandler: new FetchHtmlResponseHandler()
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchJson(url, fetchOptions) {
        let parser = fetchOptions?.parser;
        delete fetchOptions?.parser;
        let wrapOptions = {
            responseHandler: new FetchJsonResponseHandler(),
            fetchOptions: fetchOptions,
            parser: parser
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchText(url) {
        let wrapOptions = {
            responseHandler: new FetchTextResponseHandler(),
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static async wrapFetchImpl(url, wrapOptions) {
        if (BlockedHostNames.has(new URL(url).hostname)) {
            let skipurlerror = new Error("!Blocked! URL skipped because the user blocked the site");
            return wrapOptions.errorHandler.onFetchError(url, skipurlerror);
        }
        await HttpClient.setPartitionCookies(url);
        if (wrapOptions.fetchOptions == null) {
            wrapOptions.fetchOptions = HttpClient.makeOptions();
        }
        if (wrapOptions.errorHandler == null) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }
        try {
            // Use CORS proxy if enabled (website mode), unless bypassed
            let useProxy = (HttpClient.enableCorsProxy && !wrapOptions.bypassProxy);
            let fetchUrl = useProxy
                ? HttpClient.corsProxyUrl + encodeURIComponent(url)
                : url;
            // In website mode, avoid sending cookies cross-origin via credentials
            let fetchOptions = useProxy
                ? Object.assign({}, wrapOptions.fetchOptions, { credentials: "omit" })
                : wrapOptions.fetchOptions;

            let response = await fetch(fetchUrl, fetchOptions);

            // Handle CORS Proxy limitations (e.g. usage limited)
            if (useProxy && !response.ok && (response.status === 403 || response.status === 429)) {
                let text = await response.text();
                if (text.includes("corsproxy.io") || text.includes("usage limited")) {
                    console.error("[WebToEpub] CORS Proxy limit reached:", HttpClient.corsProxyUrl);
                    // Cycle to next proxy if it's one of the defaults? 
                    // For now, just let it fail and let user choose another in UI
                }
            }

            let ret = await HttpClient.checkResponseAndGetData(url, wrapOptions, response);
            if (wrapOptions.parser?.isCustomError(ret)) {
                let CustomErrorResponse = wrapOptions.parser.setCustomErrorResponse(url, wrapOptions, ret);
                return wrapOptions.errorHandler.onResponseError(CustomErrorResponse.url, CustomErrorResponse.wrapOptions, CustomErrorResponse.response, CustomErrorResponse.errorMessage);
            }
            return ret;
        }
        catch (error) {
            // If proxied fetch fails, retry direct
            if (HttpClient.enableCorsProxy && !wrapOptions.bypassProxy) {
                console.warn("[WebToEpub] Proxied fetch failed. Retrying direct:", url);
                let newOptions = Object.assign({}, wrapOptions, { bypassProxy: true });
                return HttpClient.wrapFetchImpl(url, newOptions);
            }
            // If direct fetch fails with a TypeError (CORS / network error) and proxy not yet tried,
            // auto-retry through CORS proxy
            if (!HttpClient.enableCorsProxy && error instanceof TypeError) {
                console.warn("[WebToEpub] Direct fetch failed (possible CORS). Retrying via CORS proxy:", url);
                HttpClient.enableCorsProxy = true;
                HttpClient.updateCorsProxyUi();
                return HttpClient.wrapFetchImpl(url, wrapOptions);
            }
            return wrapOptions.errorHandler.onFetchError(url, error);
        }
    }

    /** Update CORS proxy UI controls to reflect current state */
    static updateCorsProxyUi() {
        try {
            let checkbox = document.getElementById("enableCorsProxyCheckbox");
            if (checkbox) checkbox.checked = HttpClient.enableCorsProxy;
            let input = document.getElementById("corsProxyInput");
            if (input) HttpClient.corsProxyUrl = input.value || HttpClient.corsProxyUrl;
        } catch (e) { /* ignore if DOM not available */ }
    }

    static checkResponseAndGetData(url, wrapOptions, response) {
        if (!response.ok) {
            return wrapOptions.errorHandler.onResponseError(url, wrapOptions, response);
        } else {
            let handler = wrapOptions.responseHandler;
            handler.setResponse(response);
            return handler.extractContentFromResponse(response);
        }
    }

    /**
     * Extracts the original URL from a potentially proxied URL
     * @param {string} url The URL to unproxy
     * @returns {string} The original URL
     */
    static unproxyUrl(url) {
        for (let proxy of HttpClient.CORS_PROXIES) {
            if (url.startsWith(proxy.url)) {
                let encodedUrl = url.substring(proxy.url.length);
                try {
                    return decodeURIComponent(encodedUrl);
                } catch (e) {
                    return encodedUrl;
                }
            }
        }
        if (url.startsWith(HttpClient.corsProxyUrl)) {
            let encodedUrl = url.substring(HttpClient.corsProxyUrl.length);
            try {
                return decodeURIComponent(encodedUrl);
            } catch (e) {
                return encodedUrl;
            }
        }
        return url;
    }

    static async setDeclarativeNetRequestRules(RulesArray) {
        // No-op in website mode (declarativeNetRequest is extension-only)
        // In extension mode, gracefully skip if chrome.declarativeNetRequest is unavailable
        try {
            if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.updateSessionRules) return;
            let url = chrome.runtime.getURL("").split("/").filter(a => a != "");
            let id = url[url.length - 1];
            for (let i = 0; i < RulesArray.length; i++) {
                RulesArray[i].condition.initiatorDomains = [id];
            }
            let oldRules = await chrome.declarativeNetRequest.getSessionRules();
            if (oldRules == null) { oldRules = []; }
            let oldRuleIds = oldRules.map(rule => rule.id);
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: oldRuleIds,
                addRules: RulesArray
            });
        } catch (e) {
            console.log("setDeclarativeNetRequestRules skipped:", e.message);
        }
    }

    static async setPartitionCookies(url) {
        // In website mode (CORS proxy active) cookie injection is not possible or needed.
        if (HttpClient.enableCorsProxy) return;
        // Extension mode: attempt partitioned cookie injection
        try {
            let parsedUrl = new URL(url);
            let urlparts = parsedUrl.hostname.split(".");
            let domain = urlparts[urlparts.length - 2] + "." + urlparts[urlparts.length - 1];
            let cookieApi = (typeof browser !== "undefined" && util.isFirefox()) ? browser.cookies : chrome.cookies;
            let cookies = await cookieApi.getAll({ domain: domain, partitionKey: {} });
            cookies = (cookies || []).filter(item => item.partitionKey != undefined);
            cookies.forEach(element => chrome.cookies.set({
                domain: element.domain,
                url: "https://" + element.domain.substring(1),
                name: element.name,
                value: element.value
            }));
        } catch {
            // Browsers without partitionKey support (e.g. Kiwi, website mode)
            // silently skip
        }
    }
}

let BlockedHostNames = new Set();

// CORS proxy settings (website mode)
// These can be updated via the UI CORS proxy controls in popup.html
HttpClient.CORS_PROXIES = [
    { name: "allOrigins (raw)", url: "https://api.allorigins.win/raw?url=" },
    { name: "CORS.SH", url: "https://proxy.cors.sh/" },
    { name: "CodeTabs", url: "https://api.codetabs.com/v1/proxy?quest=" },
    { name: "ThingProxy", url: "https://thingproxy.freeboard.io/fetch/" },
    { name: "cors.lol", url: "https://cors.lol/?url=" },
    { name: "corsproxy.io (with key)", url: "https://corsproxy.io/?key=ab3170e1&url=" }
];
HttpClient.corsProxyUrl = HttpClient.CORS_PROXIES[0].url;
HttpClient.enableCorsProxy = false; // auto-enabled on first CORS failure

class FetchResponseHandler {
    isHtml() {
        return this.contentType.startsWith("text/html");
    }

    setResponse(response) {
        this.response = response;
        this.contentType = response.headers.get("content-type");
    }

    extractContentFromResponse(response) {
        if (this.isHtml()) {
            return this.responseToHtml(response);
        } else {
            return this.responseToBinary(response);
        }
    }

    responseToHtml(response) {
        return response.arrayBuffer().then(function (rawBytes) {
            let data = this.makeTextDecoder(response).decode(rawBytes);
            let html = new DOMParser().parseFromString(data, "text/html");
            util.setBaseTag(HttpClient.unproxyUrl(this.response.url), html);
            this.responseXML = html;
            return this;
        }.bind(this));
    }

    responseToBinary(response) {
        return response.arrayBuffer().then(function (data) {
            this.arrayBuffer = data;
            return this;
        }.bind(this));
    }

    responseToText(response) {
        return response.arrayBuffer().then(function (rawBytes) {
            return this.makeTextDecoder(response).decode(rawBytes);
        }.bind(this));
    }

    responseToJson(response) {
        return response.text().then(function (data) {
            this.json = JSON.parse(data);
            return this;
        }.bind(this));
    }

    makeTextDecoder(response) {
        let utflabel = this.charsetFromHeaders(response.headers);
        return new TextDecoder(utflabel);
    }

    charsetFromHeaders(headers) {
        let contentType = headers.get("Content-Type");
        if (!util.isNullOrEmpty(contentType)) {
            let pieces = contentType.toLowerCase().split("charset=");
            if (2 <= pieces.length) {
                return pieces[1].split(";")[0].replace(/"/g, "").trim();
            }
        }
        return FetchResponseHandler.DEFAULT_CHARSET;
    }
}
FetchResponseHandler.DEFAULT_CHARSET = "utf-8";

class FetchJsonResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToJson(response);
    }
}

class FetchTextResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToText(response);
    }
}

class FetchHtmlResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToHtml(response);
    }
}
