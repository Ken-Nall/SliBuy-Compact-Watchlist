// ==UserScript==
// @name         SliBuy MyWon Reporting Panel
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Compact one-line reporting panel for "mywon" page with clipboard functionality
// @author       Ken
// @match        https://www.slibuy.com/dashboard/mywon*
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
            <th style="width: 20%; text-align: left;">End Date</th>
            <th style="width: 25%; text-align: left;">Status</th>
          </tr>
        `;

        const tbody = document.createElement('tbody');
        tbody.id = 'reporting-table-body';

        table.appendChild(thead);
        table.appendChild(tbody);
        panel.appendChild(table);

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy to Clipboard';
        copyButton.style.marginTop = '10px';
        copyButton.style.padding = '5px 10px';
        copyButton.style.cursor = 'pointer';
        copyButton.style.backgroundColor = '#007bff';
        copyButton.style.color = '#fff';
        copyButton.style.border = 'none';
        copyButton.style.borderRadius = '4px';
        copyButton.onclick = copyToClipboard;

        panel.appendChild(copyButton);
        document.body.appendChild(panel);

        // Shift page content to the left
        document.body.style.marginRight = '640px';
    };

    const renderItem = (entry) => {
        const tbody = document.getElementById('reporting-table-body');

        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #eee';

        const titleCell = document.createElement('td');
        titleCell.textContent = truncate(entry.title);

        const priceCell = document.createElement('td');
        priceCell.textContent = `$${entry.price}`;

        const endDateCell = document.createElement('td');
        endDateCell.textContent = entry.endDate;

        const statusCell = document.createElement('td');
        statusCell.textContent = entry.status;
        if (entry.status === 'WON') statusCell.style.color = '#2e7d32'; // green
        else statusCell.style.color = '#555'; // gray

        row.appendChild(titleCell);
        row.appendChild(priceCell);
        row.appendChild(endDateCell);
        row.appendChild(statusCell);
        tbody.appendChild(row);
    };

    const clearTable = () => {
        const tbody = document.getElementById('reporting-table-body');
        tbody.innerHTML = '';
    };

    const scrapeMyWon = () => {
        const items = document.querySelectorAll('.well.list_view');
        const data = [];

        items.forEach(item => {
            const idMatch = item.querySelector('input[name="getallproids[]"]')?.value || null;

            const title = item.querySelector('h3')?.textContent.trim() || '';
            const endDateRaw = item.querySelector(`#tim${idMatch}`)?.value;
            const endDate = endDateRaw ? formatEndTime(endDateRaw) : '?';

            const priceEl = item.querySelector('span.formatCurrency');
            const price = priceEl ? priceEl.textContent.replace(/US\s\$/, '').trim() : '?';

            const statusEl = item.querySelector('.won-txt span');
            const status = statusEl?.textContent.trim() || 'Unknown';

            data.push({
                id: idMatch,
                title,
                endDate,
                price,
                status,
            });
        });

        return data;
    };

    const updateMyWon = () => {
        clearTable();
        const entries = scrapeMyWon();
        entries.forEach(renderItem);
    };
    const copyToClipboard = () => {
        const entries = scrapeMyWon();
        const text = entries.map(entry => {
            const dateOnly = entry.endDate.split(' ')[0]; // Extract date part only
            return `${entry.price}\t${dateOnly}\t${entry.title}`;
        }).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    };

    const run = () => {
        makePanel();
        updateMyWon();
        setInterval(updateMyWon, 10000); // Refresh every 10 seconds
    };

    window.addEventListener('load', () => {
        setTimeout(run, 1000);
    });
})();