// ==UserScript==
// @name         SliBuy Compact Watchlist Panel
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Compact one-line watchlist panel on current mybids page only (no iframe, table format)
// @author       Ken
// @match        https://www.slibuy.com/dashboard/mybids*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const truncate = (str, len = 40) => str.length > len ? str.slice(0, len) + '…' : str;

    const formatEndTime = (dateStr) => {
        const d = new Date(dateStr);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const hour = d.getHours() % 12 || 12;
        const min = String(d.getMinutes()).padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'p' : 'a';
        return sameDay ? `${hour}:${min}${ampm}` : `${d.getMonth() + 1}/${d.getDate()} ${hour}:${min}${ampm}`;
    };

    const parseTimeLeft = (text) => {
        const match = text.match(/(?:(\d+)H)?\s*(\d+)M/i);
        if (!match) return '';
        const [, h, m] = match.map(Number);
        return h ? `${h}h ${m}m` : `${m}m`;
    };

    const makePanel = () => {
        const panel = document.createElement('div');
        panel.style.position = 'fixed';
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.width = '640px';
        panel.style.height = '100vh';
        panel.style.overflowY = 'auto';
        panel.style.background = '#fff';
        panel.style.borderLeft = '2px solid #aaa';
        panel.style.zIndex = '9999';
        panel.style.padding = '10px';
        panel.style.fontFamily = 'sans-serif';
        panel.style.fontSize = '13px';
        panel.style.boxSizing = 'border-box';
        panel.style.color = '#000';

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        const thead = document.createElement('thead');
        thead.innerHTML = `
          <tr style="border-bottom: 1px solid #ccc; background: #f0f0f0;">
            <th style="width: 40%; text-align: left;">Title</th>
            <th style="width: 15%; text-align: left;">Price</th>
            <th style="width: 20%; text-align: left;">Time Left</th>
            <th style="width: 25%; text-align: left;">Closes</th>
            <th style="width: 15%; text-align: left;">Status</th>
          </tr>
        `;

        const tbody = document.createElement('tbody');
        tbody.id = 'watchlist-table-body';

        table.appendChild(thead);
        table.appendChild(tbody);
        panel.appendChild(table);
        document.body.appendChild(panel);

        // Shift page content to the left
        document.body.style.marginRight = '640px';
    };

    const renderItem = (entry) => {
        const tbody = document.getElementById('watchlist-table-body');

        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #eee';

        const titleCell = document.createElement('td');
        const titleLink = document.createElement('a');
        titleLink.href = '#';
        titleLink.textContent = truncate(entry.title);
        titleLink.style.color = '#0645ad';
        titleLink.style.textDecoration = 'none';
        titleLink.onclick = () => {
            bidpop(entry.id, entry.itemId, '1', entry.userId);
            return false;
        };
        titleCell.appendChild(titleLink);

        const priceCell = document.createElement('td');
        priceCell.textContent = `$${entry.price}`;

        const timeLeftCell = document.createElement('td');
        timeLeftCell.textContent = entry.timeLeft;

        const endTimeCell = document.createElement('td');
        endTimeCell.textContent = entry.endTime;

        const statusCell = document.createElement('td');
        statusCell.textContent = entry.status;
        if (entry.status === 'WINNING') statusCell.style.color = '#2e7d32'; // green
        else if (entry.status === 'LOSING') statusCell.style.color = '#c62828'; // red
        else statusCell.style.color = '#555'; // gray

        row.appendChild(titleCell);
        row.appendChild(priceCell);
        row.appendChild(timeLeftCell);
        row.appendChild(endTimeCell);
        row.appendChild(statusCell);
        tbody.appendChild(row);
    };

    const clearTable = () => {
        const tbody = document.getElementById('watchlist-table-body');
        tbody.innerHTML = '';
    };

    const scrapeWatchlist = () => {
        const items = document.querySelectorAll('.well.list_view');
        const data = [];

        items.forEach(item => {
            const idMatch = item.className.match(/rmwatch_(\d+)/);
            const id = idMatch ? idMatch[1] : null;

            const link = item.querySelector('h3 a');
            const title = link?.title || '';
            const onclick = link?.getAttribute('onclick');
            const itemIdMatch = onclick?.match(/'[^']*','(\d+)'/);
            const itemId = itemIdMatch ? itemIdMatch[1] : '';

            const userIdMatch = onclick?.match(/'[^']*','[^']*','[^']*','(\d+)'/);
            const userId = userIdMatch ? userIdMatch[1] : '';

            const timeText = item.querySelector('.timer')?.textContent?.trim() || '';
            const timeLeft = parseTimeLeft(timeText);

            const endTimeRaw = item.querySelector(`#tim${id}`)?.value;
            const endTime = endTimeRaw ? formatEndTime(endTimeRaw) : '?';

            const price = item.querySelector(`#price${id}`)?.textContent.trim() || '?';

            const statusEl = item.querySelector(`.watchsts_${id}`);
            const status = statusEl?.textContent.trim() || 'Watching';

            data.push({
                id,
                title,
                timeLeft,
                endTime,
                price,
                status,
                itemId,
                userId,
            });
        });

        return data;
    };

    const updateWatchlist = () => {
        clearTable();
        const entries = scrapeWatchlist();
        entries.forEach(renderItem);
    };

    const run = () => {
        makePanel();
        updateWatchlist();
        setInterval(updateWatchlist, 10000); // Refresh every 10 seconds
    };

    window.addEventListener('load', () => {
        setTimeout(run, 1000);
    });
})();
