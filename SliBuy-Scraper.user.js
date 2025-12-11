// ==UserScript==
// @name         SliBuy Scraper
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Scrape slibuy.com search results and present a dense interactive view
// @author       Auto-generated
// @match        https://www.slibuy.com/search*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    /*****************************************************************
     * SliBuy Scraper - Tampermonkey userscript
     *
     * Features implemented:
     * - Adds a persistent 'Scrape It!' button at top-left.
     * - Overlay UI to display scraped listings, settings, and controls.
     * - Countdown and scrape-from-last-page behavior, progress bar, cache.
     * - Settings: Range, Targets, Blacklist, Price Range, toggles.
     * - Scraper Watch (local watchlist) and 'Add to Watchlist' which opens item page.
     * - Bulk detection with hover modal showing aggregated stats.
     * - Sorting, search, per-listing timers and data age, refresh.
     *
     * Notes & assumptions:
     * - Uses same-origin fetch for pages (runs on slibuy.com so allowed).
     * - Parses generic elements found on many auction listing pages; may need
     *   minor adjustments if slibuy markup differs.
     * - Data cached in localStorage under keys: 'sliBuy_cache_v1' and 'sliBuy_settings_v1'.
     * - Plenty of console.log calls added for debugging.
     *****************************************************************/

    const LOG = (...args) => console.log('[SliBuyScraper]', ...args);

    // Storage helpers
    const STORAGE_CACHE_KEY = 'sliBuy_cache_v1';
    const STORAGE_SETTINGS_KEY = 'sliBuy_settings_v1';

    function loadCache() {
        try {
            const raw = localStorage.getItem(STORAGE_CACHE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { console.error(e); return {}; }
    }
    function saveCache(cache) {
        localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
    }

    function loadSettings() {
        const defaults = {
            range: 'today', // 'today','2days','3days','all'
            targets: [],
            blacklist: [],
            priceMin: 0,
            priceMax: 999999,
            hideBlacklist: false,
            targetsOnly: false,
            lastDaySelected: 'today'
        };
        try {
            const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
            return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
        } catch (e) { console.error(e); return defaults; }
    }
    function saveSettings(s) { localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(s)); }

    let cache = loadCache();
    let settings = loadSettings();

    // Sort state defaults: show ending soonest first and hide ended by default
    let sortKey = 'endsAt'; // default sort: ending soonest
    let sortDir = 1; // ascending (earliest first)
    let hideEndedByDefault = true;

    // UI creation
    const style = document.createElement('style');
    style.textContent = `
    #sliScrapeBtn { position: fixed; left: 10px; top: 10px; z-index: 999999; padding:8px 12px; background:#2b6cb0; color:white; border-radius:6px; cursor:pointer; font-weight:bold; }
    #sliOverlay { position: fixed; inset:0; background: rgba(0,0,0,0.6); z-index:999998; display:none; }
    #sliPanel { position: absolute; left: 40px; right: 40px; top: 40px; bottom: 40px; background: #fff; border-radius:8px; padding:12px; overflow:auto; }
    #sliTop { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
    #sliControls button { margin-right:6px; }
    #sliSettingsModal { position: fixed; left:50%; top:50%; transform:translate(-50%,-50%); background:#fff; padding:16px; border-radius:8px; box-shadow:0 6px 24px rgba(0,0,0,0.4); display:none; z-index:1000000; }
    #sliListingsTable { width:100%; border-collapse:collapse; }
    #sliListingsTable tr { border-bottom:1px solid #eee; }
    #sliListingsTable td { padding:6px 8px; vertical-align: middle; }
    .sliTarget { border-left:4px solid gold; padding-left:6px; }
    .sliBlacklisted { color:#666; }
    .sliBulkTag { background:#e2e8f0; padding:4px 6px; border-radius:4px; font-size:12px; cursor:default; }
    .sliWatchBtn { background:#edf2f7; border:1px solid #cbd5e0; padding:4px 6px; border-radius:4px; cursor:pointer; }
    .sliGreen { color:green; font-weight:bold; }
    th.sortable { cursor:pointer; text-decoration:underline; color:#2b6cb0; }
    `;
    document.head.appendChild(style);

    const scrapeBtn = document.createElement('div');
    scrapeBtn.id = 'sliScrapeBtn';
    scrapeBtn.textContent = 'Scrape It!';
    document.body.appendChild(scrapeBtn);

    const overlay = document.createElement('div');
    overlay.id = 'sliOverlay';
    overlay.innerHTML = `
        <div id="sliPanel">
            <div id="sliTop">
                <div id="sliControls">
                    <button id="sliTodayBtn">Today</button>
                    <button id="sliRefreshBtn">Refresh</button>
                    <button id="sliWatchlistBtn">Watchlist</button>
                    <button id="sliScrapeWatchBtn">Scrape Watch</button>
                    <button id="sliSettingsBtn">Settings</button>
                    <button id="sliCloseBtn">Close</button>
                </div>
                <div style="flex:1"></div>
                <div id="sliInfo">No cache loaded</div>
            </div>
            <div id="sliCountdownArea"></div>
            <div style="margin:6px 0"><input id="sliSearch" placeholder="Search listings" style="width:40%"></div>
            <div id="sliTableArea"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Settings modal
    const settingsModal = document.createElement('div');
    settingsModal.id = 'sliSettingsModal';
    settingsModal.innerHTML = `
        <h3>SliBuy Scraper Settings</h3>
        <div>
            <label>Range: </label>
            <select id="sliRangeSel">
                <option value="today">Today</option>
                <option value="2days">Next 2 days</option>
                <option value="3days">Next 3 days</option>
                <option value="all">All Listings</option>
            </select>
        </div>
        <div style="margin-top:8px"><label>Targets (comma separated):</label><br><input id="sliTargets" style="width:480px"></div>
        <div style="margin-top:8px"><label>Blacklist (comma):</label><br><input id="sliBlacklist" style="width:480px"></div>
        <div style="margin-top:8px"><label>Price min:</label><input id="sliPriceMin" type="number" style="width:100px"> <label>max:</label><input id="sliPriceMax" type="number" style="width:100px"></div>
        <div style="margin-top:8px"><label><input id="sliHideBlacklist" type="checkbox"> Hide Blacklist (unless target)</label></div>
        <div><label><input id="sliTargetsOnly" type="checkbox"> Targets Only</label></div>
        <div style="margin-top:10px"><button id="sliSaveSettings">Save</button> <button id="sliCancelSettings">Cancel</button></div>
    `;
    document.body.appendChild(settingsModal);

    // Panel internals
    const panel = document.getElementById('sliPanel');
    const countdownArea = document.getElementById('sliCountdownArea');
    const tableArea = document.getElementById('sliTableArea');
    const info = document.getElementById('sliInfo');

    // Controls
    document.getElementById('sliSettingsBtn').addEventListener('click', () => openSettings());
    document.getElementById('sliCloseBtn').addEventListener('click', () => { overlay.style.display='none'; });
    document.getElementById('sliTodayBtn').addEventListener('click', () => { settings.lastDaySelected='today'; saveSettings(settings); renderListings(); });
    document.getElementById('sliWatchlistBtn').addEventListener('click', () => { window.location.href = '/watchlist'; });
    document.getElementById('sliScrapeWatchBtn').addEventListener('click', () => { renderListings(true); });
    document.getElementById('sliRefreshBtn').addEventListener('click', () => { initiateScrapeWithCountdown(0); });

    document.getElementById('sliSearch').addEventListener('input', (e) => { renderListings(); });

    function openSettings() {
        settingsModal.style.display = 'block';
        document.getElementById('sliRangeSel').value = settings.range;
        document.getElementById('sliTargets').value = settings.targets.join(',');
        document.getElementById('sliBlacklist').value = settings.blacklist.join(',');
        document.getElementById('sliPriceMin').value = settings.priceMin;
        document.getElementById('sliPriceMax').value = settings.priceMax;
        document.getElementById('sliHideBlacklist').checked = settings.hideBlacklist;
        document.getElementById('sliTargetsOnly').checked = settings.targetsOnly;
    }
    document.getElementById('sliSaveSettings').addEventListener('click', () => {
        settings.range = document.getElementById('sliRangeSel').value;
        settings.targets = document.getElementById('sliTargets').value.split(',').map(s=>s.trim()).filter(Boolean);
        settings.blacklist = document.getElementById('sliBlacklist').value.split(',').map(s=>s.trim()).filter(Boolean);
        settings.priceMin = Number(document.getElementById('sliPriceMin').value) || 0;
        settings.priceMax = Number(document.getElementById('sliPriceMax').value) || 999999;
        settings.hideBlacklist = document.getElementById('sliHideBlacklist').checked;
        settings.targetsOnly = document.getElementById('sliTargetsOnly').checked;
        saveSettings(settings);
        settingsModal.style.display = 'none';
        renderListings();
    });
    document.getElementById('sliCancelSettings').addEventListener('click', () => { settingsModal.style.display = 'none'; });

    // When clicking main button
    scrapeBtn.addEventListener('click', () => {
        overlay.style.display = 'block';
        // Show current cache info
        const total = Object.keys(cache).length;
        info.textContent = `Cached items: ${total}`;

        if (total === 0) {
            initiateScrapeWithCountdown(5);
        } else {
            renderListings();
        }
    });

    // Countdown + scraping orchestration
    let countdownTimer = null;
    function initiateScrapeWithCountdown(seconds=5) {
        clearInterval(countdownTimer);
        let s = seconds;
        countdownArea.innerHTML = `<div id='sliCountdownMsg'>No cache! Scraping in ${s}</div>`;
        countdownTimer = setInterval(()=>{
            s--;
            if (s>0) {
                document.getElementById('sliCountdownMsg').textContent = `No cache! Scraping in ${s}`;
            } else {
                clearInterval(countdownTimer);
                document.getElementById('sliCountdownMsg').textContent = 'Starting scrape...';
                startFullScrape();
            }
        },1000);
    }

    // Determine how many pages to scrape by fetching page 1 and finding page count.
    async function estimateTotalPages() {
        LOG('Estimating total pages...');
        const url = new URL(window.location.href);
        url.searchParams.set('page', '1');
        try {
            const res = await fetch(url.toString(), { credentials:'same-origin' });
            const txt = await res.text();
            const doc = new DOMParser().parseFromString(txt, 'text/html');

            // 1) Try to read a "Displaying 1-100 Of 973" style summary
            const bodyText = doc.body ? doc.body.innerText : txt;
            let totalItems = null;
            // common patterns: "Displaying 1-100 Of 973", "Displaying 1 - 100 Of 973", "Displaying 1 to 100 of 973"
            const m1 = bodyText.match(/Displaying\s*\d+\s*(?:[-–to]+)\s*\d+\s*Of\s*([\d,]+)/i)
                    || bodyText.match(/Displaying\s*\d+\s*(?:[-–to]+)\s*\d+\s*of\s*([\d,]+)/i);
            if (m1) {
                totalItems = Number((m1[1]||'').replace(/,/g,''));
                LOG('Found total via "Displaying ..." text:', totalItems);
            }

            // 2) If not found, try to find a pagination JS call like javascript:searchpaginatee(#) in href or onclick
            if (!totalItems) {
                const anchors = Array.from(doc.querySelectorAll('a,button'));
                for (const el of anchors) {
                    const href = el.getAttribute && el.getAttribute('href') || '';
                    const onclick = el.getAttribute && el.getAttribute('onclick') || '';
                    // check href first (e.g. "javascript:searchpaginatee(12)")
                    let mm = href.match(/searchpaginatee\(\s*(\d+)\s*\)/i) || onclick.match(/searchpaginatee\(\s*(\d+)\s*\)/i);
                    if (mm) {
                        const maxPage = Number(mm[1]);
                        if (maxPage && !isNaN(maxPage)) {
                            LOG('Found total pages via searchpaginatee():', maxPage);
                            return Math.max(1, maxPage);
                        }
                    }
                    // sometimes the anchor text is the » symbol; the href may still be JS or contain page param
                    if ((el.textContent || '').trim() === '»') {
                        const h = el.getAttribute('href') || '';
                        mm = h.match(/searchpaginatee\(\s*(\d+)\s*\)/i) || h.match(/[?&]page=(\d+)/);
                        if (mm) {
                            const n = Number(mm[1]);
                            if (n && !isNaN(n)) {
                                LOG('Found total pages from » anchor:', n);
                                return Math.max(1, n);
                            }
                        }
                    }
                }
            }

            // 3) Fallback: try the previous generic pager detection (anchors with page=)
            if (!totalItems) {
                const pager = doc.querySelectorAll('a[href*="page="]');
                let maxPage = 1;
                pager.forEach(a=>{
                    const p = (a.href||'').match(/[?&]page=(\d+)/);
                    if (p) maxPage = Math.max(maxPage, Number(p[1]));
                });
                LOG('Fallback pager detection pages:', maxPage);
                return Math.max(1, maxPage);
            }

            // compute pages from totalItems assuming 100 items per page
            const pages = Math.max(1, Math.ceil(totalItems / 100));
            LOG('Computed pages from total items:', totalItems, '=>', pages);
            return pages;
        } catch (e) {
            console.error(e);
            return 10;
        }
    }

    // Helpers for time parsing and price/percent coloring

    function parseTimeStringToEnd(text) {
        if (!text) return null;
        const raw = (''+text).trim();
        // If contains explicit date string that Date can parse
        const tryDate = new Date(raw);
        if (!isNaN(tryDate.getTime())) {
            return tryDate.getTime();
        }
        // match relative like "2d 3h 4m 5s" (order flexible)
        const mDays = raw.match(/(\d+)\s*d/);
        const mHours = raw.match(/(\d+)\s*h/);
        const mMins = raw.match(/(\d+)\s*m/);
        const mSecs = raw.match(/(\d+)\s*s/);
        if (mDays || mHours || mMins || mSecs) {
            let total = 0;
            if (mDays) total += Number(mDays[1]) * 86400;
            if (mHours) total += Number(mHours[1]) * 3600;
            if (mMins) total += Number(mMins[1]) * 60;
            if (mSecs) total += Number(mSecs[1]);
            return Date.now() + total * 1000;
        }
        // common words for ended
        if (/ended|closed|finish(ed)?/i.test(raw)) return 0;
        return null;
    }

    function computeIncreased(priceNum) {
        if (isNaN(priceNum)) return NaN;
        // apply buyer's premium 18%, credit card 3%, sales tax 10%
        // multiplicative application
        return +(priceNum * 1.18 * 1.03 * 1.10);
    }

    // Color interpolation helpers across thresholds 1% (green) -> 50% (yellow) -> 75% (burgundy) -> 100% (grey)
    function hexToRgb(hex) {
        hex = hex.replace('#','');
        if (hex.length === 3) hex = hex.split('').map(h=>h+h).join('');
        const int = parseInt(hex,16);
        return {r:(int>>16)&255, g:(int>>8)&255, b:int&255};
    }
    function rgbToHex(r,g,b){ return '#' + [r,g,b].map(x=>{ const s = Math.round(x).toString(16); return s.length==1 ? '0'+s : s; }).join(''); }
    function lerp(a,b,t){ return a + (b-a)*t; }
    function colorForPercent(p) {
        if (isNaN(p)) p = 0;
        // ensure range
        if (p < 1) p = 1;
        const stops = [
            {p:1, color:'#00ff00'},    // bright green
            {p:50, color:'#ffff00'},   // yellow
            {p:75, color:'#800020'},   // burgundy
            {p:100, color:'#a6a6a6'}   // ~65% grey approximated
        ];
        // find segment
        for (let i=0;i<stops.length-1;i++){
            const a = stops[i], b = stops[i+1];
            if (p >= a.p && p <= b.p) {
                const t = (p - a.p) / (b.p - a.p);
                const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
                const r = lerp(ca.r, cb.r, t);
                const g = lerp(ca.g, cb.g, t);
                const bl = lerp(ca.b, cb.b, t);
                return rgbToHex(r,g,bl);
            }
        }
        // beyond last
        return stops[stops.length-1].color;
    }

    // Parse a search results page (HTML string) to extract listings
    function parseSearchPage(html) {
        LOG('parseSearchPage: start');
        try { LOG('parseSearchPage: html length', html ? html.length : 0); } catch(e){}

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const items = [];

        // Prefer explicit listing containers used on the site
        const primarySelectors = '.well.list_view, .well.well-bg.list_view, .list_view, .media.ss-pwrap';
        let containers = Array.from(doc.querySelectorAll(primarySelectors));
        LOG('parseSearchPage: initial container query using selectors:', primarySelectors, 'found:', containers.length);

        if (!containers.length) {
            LOG('parseSearchPage: no primary containers found, attempting anchor-derived fallback');
            // fallback: try to derive containers around anchors
            const anchors = Array.from(doc.querySelectorAll('a'));
            LOG('parseSearchPage: total anchors on page:', anchors.length);

            const candidateAnchors = anchors.filter(a => {
                const href = a.getAttribute('href') || '';
                const onclick = a.getAttribute('onclick') || '';
                const matched = /auctionid=|\/auction\/|ptitle_|bidpop|viewitem|product/i.test(href) || /bidpop/i.test(onclick);
                return matched;
            });
            LOG('parseSearchPage: candidate anchors after filtering for auction patterns:', candidateAnchors.length);
            // log a few sample hrefs/onclicks to help debugging
            candidateAnchors.slice(0,10).forEach((a, i) => {
                LOG(`parseSearchPage: sample anchor[${i}] href:`, (a.getAttribute('href')||'').slice(0,200), ' onclick:', (a.getAttribute('onclick')||'').slice(0,200));
            });

            const seen = new Set();
            candidateAnchors.forEach(a => {
                const c = a.closest('div') || a.parentElement;
                if (c && !seen.has(c)) { seen.add(c); containers.push(c); }
            });
            LOG('parseSearchPage: containers derived from anchors:', containers.length);
        }

        function tryParseDateOrRelative(dateStr) {
            try {
                const end = new Date(dateStr);
                if (!isNaN(end)) return end.getTime();
            } catch (e){}
            // try relative parser
            return parseTimeStringToEnd(dateStr);
        }

        LOG('parseSearchPage: total containers to iterate:', containers.length);
        containers.forEach((container, idx) => {
            try {
            LOG(`parseSearchPage: processing container[${idx}] - innerText length:`, (container.innerText||'').slice(0,200).length);

            // Auction ID: span.auct-id or text "Auction Id: 5504825"
            let auctionId = null;
            const auctEl = container.querySelector('.auct-id');
            if (auctEl) {
                const m = auctEl.innerText.match(/Auction\s*Id[:\s]*([0-9]+)/i);
                if (m) auctionId = m[1];
                LOG(`parseSearchPage: container[${idx}] found .auct-id ->`, auctionId);
            }

            // fallback: id in title element like ptitle_5504825
            if (!auctionId) {
                const titleById = container.querySelector('h3[id^="ptitle_"]');
                if (titleById) {
                const mid = titleById.id.match(/ptitle_(\d+)/);
                if (mid) auctionId = mid[1];
                LOG(`parseSearchPage: container[${idx}] fallback title id ->`, auctionId);
                }
            }

            // fallback: search for any digits after text "Auction Id" in container text
            if (!auctionId) {
                const m2 = container.innerText.match(/Auction\s*Id[:\s]*([0-9]+)/i);
                if (m2) auctionId = m2[1];
                LOG(`parseSearchPage: container[${idx}] fallback text match Auction Id ->`, auctionId);
            }

            // Title: h3.ftnbld (ptitle_), or img alt, or first strong text
            let title = '';
            const h3 = container.querySelector('h3.ftnbld, h3[id^="ptitle_"]');
            if (h3) title = h3.innerText.trim();
            if (!title) {
                const img = container.querySelector('img[alt]');
                if (img) title = img.getAttribute('alt').trim();
            }
            if (!title) title = (container.querySelector('.media-body')?.innerText || '').split('\n')[0].trim();
            LOG(`parseSearchPage: container[${idx}] title ->`, title);

            // Image
            const imgEl = container.querySelector('img');
            const imgsrc = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || null) : null;
            LOG(`parseSearchPage: container[${idx}] imgsrc ->`, imgsrc);

            // capture image onclick if present (e.g. magnifypopnew)
            const imgOnclick = imgEl && imgEl.getAttribute('onclick') ? imgEl.getAttribute('onclick') : null;
            if (imgOnclick) LOG(`parseSearchPage: container[${idx}] img onclick ->`, imgOnclick.slice(0,200));

            // Price: look for span#price{pid} or .formatCurrency or text "US $X"
            let price = null;
            let rawPriceText = '';
            const priceSpan = Array.from(container.querySelectorAll('[id^="price"], .formatCurrency, .masprice3648327, .buy-price')).find(el => /\d/.test(el.innerText || ''));
            if (priceSpan) {
                const text = (priceSpan.innerText || '').trim();
                rawPriceText = text;
                const m = text.match(/US\s*\$?\s*([0-9\.,]+)/i) || text.match(/([0-9\.,]+)/);
                if (m) price = (m[1] ? `$${m[1]}` : text);
                LOG(`parseSearchPage: container[${idx}] priceSpan text ->`, text, 'extracted price ->', price);
            }
            if (!price) {
                const m = container.innerText.match(/US\s*\$?\s*([0-9\.,]+)/i);
                if (m) {
                    rawPriceText = m[0];
                    price = `$${m[1]}`;
                }
                LOG(`parseSearchPage: container[${idx}] fallback price from innerText ->`, price);
            }

            // Time remaining: look for .timer content or hidden input id tim{pid}
            let timeRemaining = '';
            let endsAt = null;
            const timerEl = container.querySelector('.timer, .sch_3648327, .mys');
            LOG(`parseSearchPage: container[${idx}] timerEl found?`, !!timerEl);
            if (timerEl && timerEl.innerText.trim()) {
                timeRemaining = timerEl.innerText.trim();
                LOG(`parseSearchPage: container[${idx}] timerEl text ->`, timeRemaining);
                const parsed = parseTimeStringToEnd(timeRemaining);
                if (parsed) endsAt = parsed;
            } else {
                // hidden input with end date: id like tim{pid}
                const hiddenInputs = Array.from(container.querySelectorAll('input')).map(i => i.value).filter(Boolean);
                LOG(`parseSearchPage: container[${idx}] hidden input values samples ->`, hiddenInputs.slice(0,5));
                const hiddenTime = hiddenInputs.find(v => /\w+\s+\d{1,2}\s+\d{4}/i.test(v) || /\w{3}\s+\w+\s+\d{2,4}/.test(v) || /\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v));
                if (hiddenTime) {
                timeRemaining = hiddenTime;
                const parsed = tryParseDateOrRelative(hiddenTime);
                if (parsed) endsAt = parsed;
                LOG(`parseSearchPage: container[${idx}] hiddenTime match ->`, hiddenTime, 'parsed endsAt ->', endsAt);
                } else {
                // input with id timNNNN
                const timInput = Array.from(container.querySelectorAll('input[id^="tim"]')).map(i => i.value).find(Boolean);
                if (timInput) {
                    timeRemaining = timInput;
                    const parsed = tryParseDateOrRelative(timInput);
                    if (parsed) endsAt = parsed;
                    LOG(`parseSearchPage: container[${idx}] timInput ->`, timInput, 'parsed endsAt ->', endsAt);
                }
                }
            }
            if (!timeRemaining) {
                const tm = container.innerText.match(/(\d+\s*d|\d+\s*h|\d+\s*m|\d+\s*s)\b/g);
                if (tm) {
                timeRemaining = tm.join(' ');
                endsAt = parseTimeStringToEnd(timeRemaining);
                LOG(`parseSearchPage: container[${idx}] regex timeRemaining ->`, timeRemaining, 'endsAt ->', endsAt);
                } else {
                LOG(`parseSearchPage: container[${idx}] no timeRemaining found`);
                }
            }

            // href & onclick capture: try to build a usable link. Capture bidpop onclick string
            let href = null;
            let titleOnclick = null;
            const titleEl = container.querySelector('h3[id^="ptitle_"], h3.ftnbld');
            if (titleEl) {
                if (titleEl.getAttribute('onclick')) {
                titleOnclick = titleEl.getAttribute('onclick').trim();
                LOG(`parseSearchPage: container[${idx}] title onclick ->`, titleOnclick.slice(0,200));
                // prefer executing the onclick when user clicks in our UI by crafting a javascript: href
                // wrap to be safe and avoid naked 'this' issues
                href = `javascript:(function(){try{${titleOnclick};}catch(e){console && console.error && console.error(e);}})()`;
                }
            }

            // fallback: look for an <a> that seems to go to auction page inside container
            if (!href) {
                const a = container.querySelector('a[href*="auction"], a[href*="product"], a[href*="view"], a[href*="item"], a[href*="watch"]');
                if (a && a.href) {
                href = a.href;
                LOG(`parseSearchPage: container[${idx}] found anchor href ->`, href);
                }
            }
            // ultimate fallback: craft a search query link to the auction id or attach as query param
            if (!href && auctionId) {
                href = `${location.origin}${location.pathname}?auctionid=${auctionId}`;
                LOG(`parseSearchPage: container[${idx}] crafted fallback href ->`, href);
            }

            // Final auctionId fallback: try to get numeric from any id-like string
            if (!auctionId) {
                const alt = (container.innerText || '').match(/(\d{6,})/);
                if (alt) {
                auctionId = alt[1];
                LOG(`parseSearchPage: container[${idx}] final numeric fallback auctionId ->`, auctionId);
                }
            }

            if (!auctionId && !title) {
                LOG(`parseSearchPage: container[${idx}] skipping - no auctionId and no title`);
                return; // skip if nothing meaningful
            }

            // MSRP extraction from title (e.g. "$99 MSRP" or "99 MSRP", case-insensitive)
            let msrpRaw = null;
            let msrpVal = null;
            const msrpMatch = (title || '').match(/\$?\s*([0-9\.,]+)\s*MSRP\b/i);
            if (msrpMatch) {
                msrpRaw = msrpMatch[0];
                msrpVal = Number(msrpMatch[1].replace(/,/g,''));
                LOG(`parseSearchPage: container[${idx}] MSRP parsed ->`, msrpRaw, msrpVal);
            }

            // Compute percentage of MSRP will be computed later based on increased price
            const item = {
                auctionId: String(auctionId || (`${Math.random().toString(36).slice(2,10)}`)),
                title: title || 'Unknown',
                href: href || location.href,
                imgsrc,
                imgOnclick,
                titleOnclick, // original bidpop(...) string if present
                price: price || '',
                rawPrice: rawPriceText || (price || ''),
                msrpRaw,
                msrpValue: msrpVal,
                percentOfMsrp: null,
                timeRemaining: timeRemaining || '',
                endsAt: endsAt || null,
                rawHtml: (container.innerHTML || '').slice(0,1000),
                scrapedAt: Date.now()
            };

            LOG(`parseSearchPage: container[${idx}] parsed item ->`, { auctionId: item.auctionId, title: item.title, href: item.href, price: item.price, timeRemaining: item.timeRemaining, imgsrc: item.imgsrc, msrp: item.msrpValue });
            items.push(item);
            } catch (e) {
            LOG('parseSearchPage: container error at index', idx, e);
            }
        });

        LOG('parseSearchPage: parsed items before dedupe:', items.length);
        // de-duplicate by auctionId, keep first seen
        const seen = new Set();
        const deduped = [];
        for (const it of items) {
            if (!it.auctionId) { deduped.push(it); continue; }
            if (seen.has(it.auctionId)) {
                LOG('parseSearchPage: duplicate auctionId skipped ->', it.auctionId);
                continue;
            }
            seen.add(it.auctionId);
            deduped.push(it);
        }

        LOG('parseSearchPage: returning deduped items count:', deduped.length);
        return deduped;
    }

    // Fetch a page and parse
    async function fetchAndParsePage(pageNum) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', String(pageNum));
        LOG('Fetching page', pageNum, url.toString());

        // Helper: check for "Shipping Fee" in text (loose, case-insensitive)
        const hasShippingFee = (txt) => /Shipping\s*Fee/i.test(txt || '');

        // Try a simple fetch first (may miss JS-rendered content)
        // Always load the page into a hidden iframe so client-side scripts can render content.
        // We avoid using fetch(url.toString()) per request.
        return new Promise(async (resolve) => {
            LOG('Attempting fetch-first for page', pageNum, url.href);

            LOG('Loading page in visible iframe to allow dynamic content to render...', url.href);
            const iframe = document.createElement('iframe');
            // make visible and unobtrusive in bottom-right for debugging
            iframe.style.position = 'fixed';
            iframe.style.bottom = '10px';
            iframe.style.right = '10px';
            iframe.style.width = '100px';
            iframe.style.height = '100px';
            iframe.style.zIndex = 10000000;
            iframe.style.border = '1px solid rgba(0,0,0,0.2)';
            iframe.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            iframe.style.background = '#fff';
            iframe.src = url.href;
            // mark iframe so scripts can detect it if needed
            iframe.setAttribute('data-sli-iframe', '1');

            document.body.appendChild(iframe);

            const cleanup = () => { try { if (iframe && iframe.parentElement) document.body.removeChild(iframe); } catch (e) {} };

            const onLoad = async () => {
                try {
                    LOG('Iframe load event fired for page', pageNum);
                    // allow time for client-side rendering
                    await sleep(3000);

                    let doc;
                    try {
                        doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                    } catch (accErr) {
                        LOG('Accessing iframe.document threw (cross-origin?)', accErr);
                        cleanup();
                        return resolve([]);
                    }
                    if (!doc) {
                        LOG('No iframe document available');
                        cleanup();
                        return resolve([]);
                    }

                    // Detect if our userscript also ran inside the iframe to avoid recursion
                    try {
                        const win = iframe.contentWindow;
                        if (win && win.SliBuyScraper) {
                            LOG('Detected SliBuyScraper present inside iframe. Attempting to neutralize to avoid recursion.');
                            try { delete win.SliBuyScraper; } catch (dErr) { LOG('Delete failed', dErr); }
                            try { win.__sli_in_iframe = true; } catch (_) {}
                            await sleep(300);
                        }
                    } catch (chkErr) {
                        LOG('Error while checking iframe for existing scraper', chkErr);
                    }

                    // Wait/loop until "Shipping Fee" appears or timeout (keeps within the external iframe timeout)
                    const maxChecks = 6; // total wait up to ~6 seconds (1200 initial + up to 6*1000)
                    let found = false;
                    for (let i = 0; i < maxChecks; i++) {
                        const bodyText = (doc.body && doc.body.innerText) || (doc.documentElement && doc.documentElement.innerText) || '';
                        LOG(`Iframe check ${i+1}/${maxChecks} body text length:`, bodyText ? bodyText.length : 0);
                        if (hasShippingFee(bodyText)) {
                            found = true;
                            LOG('"Shipping Fee" detected inside iframe content on check', i+1);
                            // wait an additional second as requested before proceeding
                            await sleep(1000);
                            break;
                        }
                        // if not found, wait 1s then re-read DOM (gives dynamic scripts time)
                        await sleep(1000);
                    }
                    if (!found) {
                        LOG('"Shipping Fee" not detected in iframe after retries — proceeding with parse anyway.');
                    }

                    const html = doc.documentElement ? doc.documentElement.outerHTML : '';
                    const parsed = parseSearchPage(html);
                    LOG(`Iframe parsed ${parsed.length} items from page ${pageNum} via iframe`);
                    cleanup();
                    return resolve(parsed);
                } catch (err) {
                    LOG('Iframe parse error', err);
                    cleanup();
                    return resolve([]);
                }
            };

            // robust listeners with error handling
            try {
                iframe.addEventListener('load', onLoad, { once: true });
                iframe.addEventListener('error', (e) => {
                    LOG('Iframe error event', e);
                }, { once: true });
            } catch (e) {
                LOG('Adding iframe event listeners failed', e);
                // best-effort cleanup and resolve empty
                cleanup();
                return resolve([]);
            }

            // safety timeout (longer to allow rendering)
            const to = setTimeout(() => {
                LOG('Iframe timeout reached, aborting parse for page', pageNum);
                cleanup();
                resolve([]);
            }, 20000);
        });
    }

    async function startFullScrape() {
        info.textContent = 'Detecting number of pages...';
        const totalPages = await estimateTotalPages();
        info.textContent = `Detected ${totalPages} pages. Starting from last to first.`;
        // We'll scrape last->first
        let totalDetected = 0;
        let scrapedCount = 0;
        // For progress UI
        countdownArea.innerHTML = `<div>Currently scraping... <span id='sliProg'>0</span> / <span id='sliTotal'>${totalPages}</span> pages</div>
            <div style='background:#eee;height:10px;border-radius:6px;margin-top:6px'><div id='sliProgressBar' style='height:10px;background:#67C23A;width:0%;border-radius:6px'></div></div>`;

        for (let p = totalPages; p>=1; p--) {
            document.getElementById('sliProg').textContent = `${totalPages - p + 1}`;
            const items = await fetchAndParsePage(p);
            scrapedCount += 1;
            totalDetected += items.length;
            // Store each item in cache by auctionId
            items.forEach(it=>{
                cache[it.auctionId] = Object.assign(cache[it.auctionId]||{}, it);
            });
            // save after each page
            saveCache(cache);
            const pct = Math.round((scrapedCount / totalPages)*100);
            document.getElementById('sliProgressBar').style.width = pct + '%';
            await sleep(300); // small pause to be nicer
        }
        LOG('Scrape complete. Items detected:', Object.keys(cache).length);
        info.textContent = `Scrape complete. Items cached: ${Object.keys(cache).length}`;
        countdownArea.innerHTML = `<div>Scrape complete. Items cached: ${Object.keys(cache).length}</div>`;
        renderListings();
    }

    function sleep(ms) { return new Promise(resolve=>setTimeout(resolve, ms)); }

    // Render listings into tableArea. If showScraperWatch true, show only items in local scraper watch
    function renderListings(showScraperWatch=false) {
        cache = loadCache();
        settings = loadSettings();
        const items = Object.values(cache || {});
        LOG('Rendering', items.length, 'items; showScraperWatch=', showScraperWatch);
        let filtered = items.slice();
        // Apply settings filters
        // Price filter: parse price to number
        filtered = filtered.filter(it => {
            const priceNum = parsePrice(it.rawPrice || it.price);
            if (isNaN(priceNum)) return true; // keep if no price
            return priceNum >= settings.priceMin && priceNum <= settings.priceMax;
        });
        // Targets/blacklist handling
        const q = document.getElementById('sliSearch').value.trim().toLowerCase();
        filtered = filtered.filter(it => {
            const t = (it.title||'').toLowerCase();
            if (q && !t.includes(q)) return false;
            // targetsOnly
            if (settings.targetsOnly && !settings.targets.some(k=>t.includes(k.toLowerCase()))) return false;
            // blacklist hide
            if (settings.hideBlacklist && settings.blacklist.some(b=>t.includes(b.toLowerCase()))) {
                // unless target also
                if (!settings.targets.some(k=>t.includes(k.toLowerCase()))) return false;
            }
            return true;
        });

        // If showScraperWatch, only show items in our internal watchlist stored under 'sliScraperWatch_v1'
        if (showScraperWatch) {
            const w = JSON.parse(localStorage.getItem('sliScraperWatch_v1')||'[]');
            filtered = filtered.filter(it=> w.includes(it.auctionId));
        }

        // Default hide ended auctions
        if (hideEndedByDefault) {
            filtered = filtered.filter(it=>{
                if (it.endsAt) return it.endsAt > Date.now();
                // fallback to text-based heuristic
                return !hasEnded(it);
            });
        }

        // For each item compute numeric price and increased price and pct of MSRP
        filtered.forEach(it=>{
            it._priceNum = parsePrice(it.rawPrice || it.price);
            it._increased = isNaN(it._priceNum) ? NaN : computeIncreased(it._priceNum);
            it._pctOfMsrp = (it.msrpValue && !isNaN(it._increased) ? +(it._increased / it.msrpValue * 100).toFixed(1) : null);
        });

        // Bulk detection: group by normalized title
        const groups = {};
        filtered.forEach(it=>{
            const key = normalizeTitle(it.title);
            groups[key] = groups[key] || [];
            groups[key].push(it);
        });

        // Sorting
        filtered.sort((a,b)=>{
            const va = getSortValue(a, sortKey);
            const vb = getSortValue(b, sortKey);
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1 * sortDir;
            if (vb === null || vb === undefined) return -1 * sortDir;
            return (va < vb ? -1 : 1) * sortDir;
        });

        // Build table
        const table = document.createElement('table');
        table.id = 'sliListingsTable';
        const header = document.createElement('tr');

        // Helper to create sortable th
        function makeTh(label, key) {
            const th = document.createElement('th');
            th.textContent = label;
            th.className = 'sortable';
            th.dataset.key = key;
            th.addEventListener('click', ()=>{
                if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = (key === 'endsAt' ? 1 : -1); } // default dir: endsAt asc, others desc
                renderListings(showScraperWatch);
            });
            return th;
        }

        header.appendChild(makeTh('Current Price', 'price'));
        header.appendChild(makeTh('%MSRP', 'pctOfMsrp'));
        header.appendChild(makeTh('Max Bid', 'maxBid'));
        header.appendChild(makeTh('Title', 'title'));
        header.appendChild(makeTh('Time Remaining', 'endsAt'));
        header.appendChild(makeTh('Bulk', 'bulkCount'));
        header.appendChild(makeTh('Watch', 'watch'));
        header.appendChild(makeTh('Scraper Watch', 'scraperWatch'));
        header.appendChild(makeTh('Age', 'scrapedAt'));
        header.appendChild(makeTh('Refresh', 'refresh'));
        table.appendChild(header);

        // iterate items and add rows
        filtered.forEach(it=>{
            const tr = document.createElement('tr');
            // highlight rules
            const titleLower = (it.title||'').toLowerCase();
            const isTarget = settings.targets.some(k=>titleLower.includes(k.toLowerCase()));
            const isBlack = settings.blacklist.some(k=>titleLower.includes(k.toLowerCase()));

            if (isTarget) {
                tr.style.fontWeight = 'bold';
                tr.style.background = '#fff9e6'; // light golden
            }
            if (isBlack) {
                tr.style.fontStyle = 'italic';
                tr.style.fontSize = '0.9em';
                tr.style.opacity = tr.style.opacity || '0.9';
            }

            const priceText = (!isNaN(it._priceNum) ? '$' + it._priceNum.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '');
            const increasedText = (!isNaN(it._increased) ? '[' + '$' + it._increased.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) + ']' : '');
            const pct = it._pctOfMsrp;

            // Compute bulk count for this normalized title
            const bulkKey = normalizeTitle(it.title);
            const bulkCount = (groups[bulkKey] || []).length;

            // Build row cells
            const priceCell = document.createElement('td');
            priceCell.innerHTML = `${priceText} ${increasedText}`;
            const pctCell = document.createElement('td');
            if (pct !== null) {
                const span = document.createElement('span');
                span.textContent = `${pct}%`;
                span.style.color = colorForPercent(pct);
                pctCell.appendChild(span);
            } else {
                pctCell.textContent = '';
            }
            const maxBidCell = document.createElement('td');
            maxBidCell.textContent = it.maxBid || '';
            const titleCell = document.createElement('td');
            titleCell.innerHTML = `<span class='sliTitle' data-id='${it.auctionId}' style='cursor:pointer'>${escapeHtml(it.title)}</span>`;
            if (isTarget) titleCell.classList.add('sliTarget');
            if (isBlack) titleCell.classList.add('sliBlacklisted');

            const timeCell = document.createElement('td');
            timeCell.textContent = it.timeRemaining|| (it.endsAt ? msUntil(it.endsAt) : '');

            const bulkCell = document.createElement('td');
            if (bulkCount>1) {
                const b = document.createElement('span');
                b.className = 'sliBulkTag';
                b.textContent = 'BULK';
                b.title = `${bulkCount} similar listings`;
                b.addEventListener('mouseenter', (e)=> showBulkHover(e, groups[bulkKey]));
                b.addEventListener('mouseleave', hideBulkHover);
                b.addEventListener('click', ()=> renderBulkOnly(groups[bulkKey]));
                bulkCell.appendChild(b);
            }

            const watchCell = document.createElement('td');
            const watchBtn = document.createElement('button');
            watchBtn.className = 'sliWatchBtn';
            watchBtn.textContent = 'Open';
            watchBtn.title = 'Open item page (use site Add to Watchlist there)';
            watchBtn.addEventListener('click', ()=> window.open(it.href, '_blank'));
            watchCell.appendChild(watchBtn);

            const swCell = document.createElement('td');
            const swBtn = document.createElement('button');
            swBtn.className = 'sliWatchBtn';
            const watchArr = JSON.parse(localStorage.getItem('sliScraperWatch_v1')||'[]');
            const onWatch = watchArr.includes(it.auctionId);
            swBtn.textContent = onWatch ? 'Unwatch' : 'Scraper Watch';
            if (onWatch) swBtn.classList.add('sliGreen');
            swBtn.addEventListener('click', ()=>{
                let arr = JSON.parse(localStorage.getItem('sliScraperWatch_v1')||'[]');
                if (arr.includes(it.auctionId)) arr = arr.filter(x=>x!==it.auctionId); else arr.push(it.auctionId);
                localStorage.setItem('sliScraperWatch_v1', JSON.stringify(arr));
                renderListings(showScraperWatch);
            });
            swCell.appendChild(swBtn);

            const ageCell = document.createElement('td');
            ageCell.textContent = ageText(it.scrapedAt);

            const refreshCell = document.createElement('td');
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'sliRefreshSingle';
            refreshBtn.dataset.id = it.auctionId;
            refreshBtn.textContent = '↻';
            refreshCell.appendChild(refreshBtn);

            tr.appendChild(priceCell);
            tr.appendChild(pctCell);
            tr.appendChild(maxBidCell);
            tr.appendChild(titleCell);
            tr.appendChild(timeCell);
            tr.appendChild(bulkCell);
            tr.appendChild(watchCell);
            tr.appendChild(swCell);
            tr.appendChild(ageCell);
            tr.appendChild(refreshCell);

            // Title hover image preview
            const titleSpan = titleCell.querySelector('.sliTitle');
            titleSpan.addEventListener('mouseenter', (e)=> showImagePreview(e, it.imgsrc));
            titleSpan.addEventListener('mouseleave', hideImagePreview);
            titleSpan.addEventListener('click', ()=> { overlay.style.display='none'; window.location.href = it.href; });

            // Refresh single
            refreshBtn.addEventListener('click', async ()=>{
                // fetch item page and update cache entry if possible
                try {
                    const r = await fetch(it.href, { credentials:'same-origin' });
                    const t = await r.text();
                    const parsed = parseSearchPage(t);
                    // find matching auctionId
                    const found = parsed.find(p=>p.auctionId === it.auctionId) || parsed[0];
                    if (found) { cache[it.auctionId] = Object.assign(cache[it.auctionId]||{}, found); saveCache(cache); renderListings(showScraperWatch); }
                } catch (e) { console.error(e); }
            });

            table.appendChild(tr);
        });

        tableArea.innerHTML = '';
        tableArea.appendChild(table);
    }

    function getSortValue(it, key) {
        switch(key) {
            case 'price': return (it._priceNum || 0);
            case 'pctOfMsrp': return (it._pctOfMsrp === null ? -1 : it._pctOfMsrp);
            case 'maxBid': return parsePrice(it.maxBid) || 0;
            case 'title': return (it.title || '').toLowerCase();
            case 'endsAt': return it.endsAt || (it.timeRemaining ? Date.now()+999999999 : Infinity);
            case 'bulkCount': return 0; // handled externally if needed
            case 'scrapedAt': return it.scrapedAt || 0;
            case 'age': return it.scrapedAt || 0;
            default: return it[key];
        }
    }

    function parsePrice(priceText) {
        if (!priceText) return NaN;
        const m = (''+priceText).replace(/[,\s]/g,'').match(/(\d+(?:\.\d+)?)/);
        return m ? Number(m[1]) : NaN;
    }

    function ageText(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        const s = Math.floor(diff/1000);
        if (s<60) return `${s}s`;
        const m = Math.floor(s/60);
        if (m<60) return `${m}m`;
        const h = Math.floor(m/60);
        if (h<24) return `${h}h`;
        const d = Math.floor(h/24);
        return `${d}d`;
    }

    function msUntil(ts) {
        if (!ts) return '';
        const diff = Math.max(0, ts - Date.now());
        const s = Math.floor(diff/1000);
        if (s<60) return `${s}s`;
        const m = Math.floor(s/60);
        if (m<60) return `${m}m`;
        const h = Math.floor(m/60);
        if (h<24) return `${h}h`;
        const d = Math.floor(h/24);
        return `${d}d`;
    }

    function normalizeTitle(t) {
        return (t||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').slice(0,6).join(' ');
    }

    // Bulk hover modal
    let bulkHover = null;
    function showBulkHover(e, group) {
        if (!group || group.length===0) return;
        if (!bulkHover) {
            bulkHover = document.createElement('div');
            bulkHover.style.position='fixed'; bulkHover.style.zIndex=1000001; bulkHover.style.background='#fff'; bulkHover.style.padding='8px'; bulkHover.style.border='1px solid #ccc'; bulkHover.style.borderRadius='6px';
            document.body.appendChild(bulkHover);
        }
        const closed = group.filter(it=> hasEnded(it));
        const open = group.filter(it=> !hasEnded(it));
        const closedPrices = closed.map(it=>parsePrice(it.price)).filter(n=>!isNaN(n));
        const openPrices = open.map(it=>parsePrice(it.price)).filter(n=>!isNaN(n));
        const closedStats = closed.length ? `${closed.length} closed at $${Math.min(...closedPrices)} to $${Math.max(...closedPrices)} averaging $${(closedPrices.reduce((a,b)=>a+b,0)/closedPrices.length).toFixed(2)}` : '0 closed';
        const openStats = open.length ? `${open.length} open from $${Math.min(...openPrices)} to $${Math.max(...openPrices)} averaging $${(openPrices.reduce((a,b)=>a+b,0)/openPrices.length).toFixed(2)}` : '0 open';
        bulkHover.innerHTML = `${group.length} listings. ${closedStats}. ${openStats}.`;
        bulkHover.style.left = (e.pageX+12)+'px';
        bulkHover.style.top = (e.pageY+12)+'px';
        bulkHover.style.display='block';
    }
    function hideBulkHover(){ if (bulkHover) bulkHover.style.display='none'; }

    function renderBulkOnly(group) {
        // show overlay but render only this group's items
        tableArea.innerHTML = '';
        const back = document.createElement('div');
        back.innerHTML = `<button id='sliBackFromBulk'>Back</button>`;
        tableArea.appendChild(back);
        document.getElementById('sliBackFromBulk').addEventListener('click', ()=> renderListings());
        // build table for group
        const table = document.createElement('table'); table.id='sliListingsTable';
        const header = document.createElement('tr'); header.innerHTML = `<th>Price</th><th>Title</th><th>Time</th><th>Watch</th>`; table.appendChild(header);
        group.forEach(it=>{
            const tr=document.createElement('tr'); tr.innerHTML = `<td>${it.price||''}</td><td><span class='sliTitle' data-id='${it.auctionId}' style='cursor:pointer'>${escapeHtml(it.title)}</span></td><td>${it.timeRemaining||''}</td><td></td>`;
            tr.querySelector('.sliTitle').addEventListener('click', ()=> { overlay.style.display='none'; window.location.href = it.href; });
            table.appendChild(tr);
        });
        tableArea.appendChild(table);
    }

    function hasEnded(it) {
        // Use endsAt if present
        if (it && it.endsAt !== undefined && it.endsAt !== null) {
            return it.endsAt <= Date.now();
        }
        // heuristic: timeRemaining contains 'ended' or similar text; we treat missing timeRemaining as unknown (return false)
        if (!it.timeRemaining) return false;
        return /ended|closed|finish/i.test(it.timeRemaining);
    }

    // Image preview
    let imgPreview = null;
    function showImagePreview(e, src) {
        if (!src) return;
        if (!imgPreview) {
            imgPreview = document.createElement('div');
            imgPreview.style.position='fixed'; imgPreview.style.zIndex=1000002; imgPreview.style.padding='6px'; imgPreview.style.background='#fff'; imgPreview.style.border='1px solid #ccc'; imgPreview.style.borderRadius='6px';
            imgPreview.innerHTML = `<img id='sliPreviewImg' src='' style='max-width:260px;max-height:260px'/>`;
            document.body.appendChild(imgPreview);
        }
        imgPreview.style.left = (e.pageX+12)+'px'; imgPreview.style.top = (e.pageY+12)+'px';
        imgPreview.querySelector('#sliPreviewImg').src = src;
        imgPreview.style.display='block';
    }
    function hideImagePreview(){ if (imgPreview) imgPreview.style.display='none'; }

    // helpers
    function escapeHtml(unsafe) { return (unsafe||'').replace(/[&<"']/g, function(m){return {'&':'&amp;','<':'&lt;','"':'&quot;',"'":'&#039;'}[m];}); }

    // Initial render if cache exists
    if (Object.keys(cache).length>0) {
        LOG('Cache loaded at start with', Object.keys(cache).length, 'items');
    }

    // Expose some functions to window for debugging
    window.SliBuyScraper = { startFullScrape, renderListings, cacheKey: STORAGE_CACHE_KEY, settingsKey: STORAGE_SETTINGS_KEY };

    LOG('SliBuy Scraper injected. Ready.');

})();
