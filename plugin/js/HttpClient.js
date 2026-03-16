"use strict";

/*
  HttpClient for WebToEpub
  Fixed version:
  - automatic proxy rotation
  - CORS safe
  - retries on failure
  - stable for novel sites
*/

class FetchErrorHandler {

    makeFailMessage(url, error) {
        return `Fetch of URL '${url}' failed with error: ${error}`;
    }

    makeFailCanRetryMessage(url, error) {
        return this.makeFailMessage(url, error) + " (Retry possible)";
    }

    getCancelButtonText() {
        return "Cancel";
    }

    onFetchError(url, error) {
        console.error("[FetchError]", url, error);
        return Promise.reject(new Error(this.makeFailMessage(url, error.message)));
    }

    onResponseError(url, wrapOptions, response, errorMessage) {

        let failError;

        if (errorMessage) {
            failError = new Error(errorMessage);
        } else {
            failError = new Error(
                `HTTP ${response.status} error while fetching ${url}`
            );
        }

        return Promise.reject(failError);
    }

}


class HttpClient {

    static makeOptions() {
        return {
            credentials: "omit",
            mode: "cors"
        };
    }

    static wrapFetch(url, wrapOptions) {

        if (!wrapOptions) {
            wrapOptions = {
                errorHandler: new FetchErrorHandler()
            };
        }

        if (!wrapOptions.errorHandler) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }

        if (!wrapOptions.responseHandler) {
            wrapOptions.responseHandler = new FetchResponseHandler();
        }

        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }


    static fetchHtml(url) {

        let wrapOptions = {
            responseHandler: new FetchHtmlResponseHandler()
        };

        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }


    static fetchText(url) {

        let wrapOptions = {
            responseHandler: new FetchTextResponseHandler()
        };

        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }


    static fetchJson(url, fetchOptions) {

        let wrapOptions = {
            responseHandler: new FetchJsonResponseHandler(),
            fetchOptions: fetchOptions
        };

        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }



    static async wrapFetchImpl(url, wrapOptions) {

        if (!wrapOptions.fetchOptions) {
            wrapOptions.fetchOptions = HttpClient.makeOptions();
        }

        if (!wrapOptions.errorHandler) {
            wrapOptions.errorHandler = new FetchErrorHandler();
        }

        let proxies = [...HttpClient.CORS_PROXIES];

        for (let proxy of proxies) {

            try {

                let fetchUrl = proxy + encodeURIComponent(url.trim());

                console.log("[WebToEpub] Trying proxy:", proxy);

                let response = await fetch(fetchUrl, wrapOptions.fetchOptions);

                if (!response.ok) {

                    if (
                        response.status === 403 ||
                        response.status === 429 ||
                        response.status === 503
                    ) {

                        console.warn(
                            `[WebToEpub] Proxy blocked (${response.status})`
                        );

                        continue;
                    }

                    return wrapOptions.errorHandler.onResponseError(
                        url,
                        wrapOptions,
                        response
                    );
                }

                let handler = wrapOptions.responseHandler;

                handler.setResponse(response);

                let ret = await handler.extractContentFromResponse(response);

                return ret;

            } catch (error) {

                console.warn(
                    "[WebToEpub] Proxy failed:",
                    proxy,
                    error.message
                );

                continue;
            }
        }

        console.warn("[WebToEpub] All proxies failed");

        return wrapOptions.errorHandler.onFetchError(
            url,
            new Error("All CORS proxies failed")
        );
    }


    static unproxyUrl(url) {

        for (let proxy of HttpClient.CORS_PROXIES) {

            if (url.startsWith(proxy)) {

                let encoded = url.substring(proxy.length);

                try {
                    return decodeURIComponent(encoded);
                } catch {
                    return encoded;
                }

            }

        }

        return url;
    }

}



/* ---------- Proxy List ---------- */

HttpClient.CORS_PROXIES = [

    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy?quest=",
    "https://cors.lol/?url=",
    "https://thingproxy.freeboard.io/fetch/",
    "https://corsproxy.io/?url="

];



/* ---------- Response Handlers ---------- */


class FetchResponseHandler {

    setResponse(response) {
        this.response = response;
        this.contentType = response.headers.get("content-type") || "";
    }

    extractContentFromResponse(response) {

        if (this.contentType.includes("text/html")) {
            return this.responseToHtml(response);
        }

        return this.responseToBinary(response);
    }

    async responseToHtml(response) {

        let text = await response.text();

        let html = new DOMParser().parseFromString(text, "text/html");

        this.responseXML = html;

        return this;
    }

    async responseToBinary(response) {

        this.arrayBuffer = await response.arrayBuffer();

        return this;
    }

}


class FetchHtmlResponseHandler extends FetchResponseHandler {

    extractContentFromResponse(response) {
        return this.responseToHtml(response);
    }

}


class FetchTextResponseHandler extends FetchResponseHandler {

    async extractContentFromResponse(response) {

        this.text = await response.text();

        return this;
    }

}


class FetchJsonResponseHandler extends FetchResponseHandler {

    async extractContentFromResponse(response) {

        this.json = await response.json();

        return this;
    }

}