// ==UserScript==
// @name         SliBuy-Target-Black
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Scrape listings from SliBuy and display them in a table with filtering options.
// @author       You
// @match        https://www.slibuy.com/search*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const log = (message) => console.log(`[SliBuy-Target-Black]: ${message}`);

    const createTable = () => {
        const controlContainer = document.createElement('div');
        controlContainer.id = 'slibuy-control-container';
        controlContainer.style.position = 'fixed';
        controlContainer.style.top = '10px';
        controlContainer.style.left = '0';
        controlContainer.style.width = '95%';
        controlContainer.style.backgroundColor = '#fff';
        controlContainer.style.border = '1px solid #ccc';
        controlContainer.style.padding = '10px';
        controlContainer.style.zIndex = '10000';

        const buttonContainer = document.createElement('div');
        buttonContainer.style.marginBottom = '10px';

        const refreshButton = document.createElement('button');
        refreshButton.textContent = 'Refresh';
        refreshButton.style.marginRight = '10px';
        refreshButton.onclick = () => {
            log('Refresh button clicked');
            scrapeListings();
        };

        const hideButton = document.createElement('button');
        hideButton.textContent = 'Hide Table';
        hideButton.style.marginRight = '10px';
        hideButton.onclick = () => {
            document.getElementById('slibuy-table').style.display = 'none';
            log('Table hidden');
        };

        const showButton = document.createElement('button');
        showButton.textContent = 'Show Table';
        showButton.style.marginRight = '10px';
        showButton.onclick = () => {
            document.getElementById('slibuy-table').style.display = 'block';
            log('Table shown');
        };

        const colorButton = document.createElement('button');
        colorButton.textContent = 'Colorize';
        colorButton.style.marginRight = '10px';
        colorButton.onclick = () => {
            scrapeListings(); // Trigger refresh which recolors listings too
            log('Colorized');
        };

        const blacklistInput = document.createElement('input');
        blacklistInput.type = 'text';
        blacklistInput.placeholder = 'Blacklist (comma-separated)';
        blacklistInput.style.marginRight = '10px';
        blacklistInput.value = GM_getValue('blacklist', '');
        blacklistInput.onchange = () => {
            GM_setValue('blacklist', blacklistInput.value);
            log(`Blacklist updated: ${blacklistInput.value}`);
            scrapeListings();
        };

        const targetlistInput = document.createElement('input');
        targetlistInput.type = 'text';
        targetlistInput.placeholder = 'Targetlist (comma-separated)';
        targetlistInput.style.marginRight = '10px';
        targetlistInput.value = GM_getValue('targetlist', '');
        targetlistInput.onchange = () => {
            GM_setValue('targetlist', targetlistInput.value);
            log(`Targetlist updated: ${targetlistInput.value}`);
            scrapeListings();
        };

        const ignoreOriginalCheckbox = document.createElement('input');
        ignoreOriginalCheckbox.type = 'checkbox';
        ignoreOriginalCheckbox.style.marginLeft = '10px';
        ignoreOriginalCheckbox.id = 'ignore-original-title';
        ignoreOriginalCheckbox.checked = GM_getValue('ignoreOriginalTitle', false);
        ignoreOriginalCheckbox.onchange = () => {
            GM_setValue('ignoreOriginalTitle', ignoreOriginalCheckbox.checked);
            log(`Ignore Original Title: ${ignoreOriginalCheckbox.checked}`);
            scrapeListings();
        };

        const ignoreLabel = document.createElement('label');
        ignoreLabel.htmlFor = 'ignore-original-title';
        ignoreLabel.textContent = 'Ignore Original Title';
        ignoreLabel.style.marginLeft = '5px';

        const table = document.createElement('table');
        table.id = 'slibuy-table';
        table.style.width = '95%';
        table.style.borderCollapse = 'collapse';
        table.style.maxHeight = '70vh';
        table.style.overflowY = 'auto';
        table.style.display = 'block';

        buttonContainer.appendChild(refreshButton);
        buttonContainer.appendChild(hideButton);
        buttonContainer.appendChild(showButton);
        buttonContainer.appendChild(colorButton);
        buttonContainer.appendChild(blacklistInput);
        buttonContainer.appendChild(targetlistInput);
        buttonContainer.appendChild(ignoreOriginalCheckbox);
        buttonContainer.appendChild(ignoreLabel);

        controlContainer.appendChild(buttonContainer);
        controlContainer.appendChild(table);
        document.body.appendChild(controlContainer);
    };

    const scrapeListings = () => {
        log('Scraping listings...');
        const table = document.getElementById('slibuy-table');
        table.innerHTML = ''; // Clear existing rows

        const blacklist = GM_getValue('blacklist', '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
        const targetlist = GM_getValue('targetlist', '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
        const ignoreOriginalTitle = GM_getValue('ignoreOriginalTitle', false);

        const listings = document.querySelectorAll('.well.list_view');
        const targetRows = [], neutralRows = [], blacklistRows = [];

        listings.forEach((listing) => {
            const titleElement = listing.querySelector('h3');
            const title = titleElement?.textContent.trim() || '';

            const priceElement = listing.querySelector('.masprice3382842') || listing.querySelector('.price') || listing.querySelector('.masprice') || listing.querySelector('span[style*="price"]');
            const price = priceElement?.textContent.trim() || 'N/A';

            const timeLeftElement = listing.querySelector('.timer');
            const timeLeft = timeLeftElement?.textContent.trim() || '';

            const statusElement = listing.querySelector('.pro_condition');
            const status = statusElement?.textContent.trim() || '';

            const row = document.createElement('tr');
            const titleCell = document.createElement('td');
            const priceCell = document.createElement('td');
            const timeLeftCell = document.createElement('td');
            const statusCell = document.createElement('td');

            titleCell.textContent = title;
            titleCell.style.cursor = 'pointer';
            titleCell.onclick = titleElement?.onclick || null;

            priceCell.textContent = price;
            priceCell.style.border = '1px solid #ccc';
            timeLeftCell.textContent = timeLeft;
            timeLeftCell.style.border = '1px solid #ccc';
            statusCell.textContent = status;
            statusCell.style.border = '1px solid #ccc';

            [titleCell, priceCell, timeLeftCell, statusCell].forEach(cell => {
                cell.style.whiteSpace = 'nowrap';
                cell.style.overflow = 'hidden';
                cell.style.textOverflow = 'ellipsis';
            });

            row.appendChild(titleCell);
            row.appendChild(priceCell);
            row.appendChild(timeLeftCell);
            row.appendChild(statusCell);

            const lowerTitle = title.toLowerCase();
            const displayTitle = titleCell.textContent.toLowerCase();
            const compareTitle = ignoreOriginalTitle ? displayTitle : lowerTitle;

            if (blacklist.some(word => compareTitle.includes(word))) {
                row.style.backgroundColor = 'darkgrey';   
                listing.style.display = 'none'; // ⬅️ Hides entire listing
                blacklistRows.push(row);
            } else if (targetlist.some(word => compareTitle.includes(word))) {
                row.style.backgroundColor = 'darkgreen';
                listing.style.backgroundColor = 'darkgreen';
                targetRows.push(row);
            } else {
                neutralRows.push(row);
            }
        });

        [...targetRows, ...neutralRows, ...blacklistRows].forEach(row => table.appendChild(row));
        log('Listings scraped and table updated.');
    };

    const waitForDOM = () => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            createTable();
            scrapeListings();
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                createTable();
                scrapeListings();
            });
        }
    };

    waitForDOM();
})();
