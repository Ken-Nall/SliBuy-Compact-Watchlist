// ==UserScript==
// @name         SliBuy Compact Watchlist
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Streamline SliBuy search page by removing unnecessary elements and spacing.
// @author       You
// @match        *://*.slibuy.com/search*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Hide location and retrieval options
    document.querySelectorAll('.buy-price.mob-grid, .mob-grid').forEach(el => {
        el.style.display = 'none';
    });

    // Hide business name
    document.querySelectorAll('.buy-price.padrig.mob-grid').forEach(el => {
        if (el.textContent.includes('Business Name:')) {
            el.style.display = 'none';
        }
    });

    // Hide auction ID
    document.querySelectorAll('.auct-id').forEach(el => {
        el.style.display = 'none';
    });

    // Remove height-impacting borders and spacing
    document.querySelectorAll('.well, .media, .caption_bk').forEach(el => {
        el.style.border = 'none';
        el.style.margin = '0';
        el.style.padding = '0';
    });
})();