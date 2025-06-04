// ==UserScript==
// @name         SliBuy Watchlist Summary (Merged)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Summarize SliBuy search listings into a sidebar panel with blacklist + targetlist support + refresh + debug logs
// @match        https://www.slibuy.com/search*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BLACKLIST_KEY = 'sli_blacklist';
    const TARGETLIST_KEY = 'sli_targetlist';

    let blacklist = JSON.parse(localStorage.getItem(BLACKLIST_KEY) || '[]');
    let targetlist = JSON.parse(localStorage.getItem(TARGETLIST_KEY) || '[]');

    const statusColors = {
        'Winning': 'lightgreen',
        'Losing': 'lightcoral',
        'Watching': 'lightgray',
    };

    function formatTime(raw) {
        try {
            const closeDate = new Date(raw);
            const now = new Date();
            const diffMs = closeDate - now;
            if (diffMs < 0) return 'Ended';

            const mins = Math.round(diffMs / (60 * 1000));
            return `${mins}m`;
        } catch {
            return 'Unknown';
        }
    }

    function formatEndDate(raw) {
        try {
            const d = new Date(raw);
            return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        } catch {
            return 'N/A';
        }
    }

    function extractData(card) {
        console.log("📦 Analyzing card:", card);

        const idSpan = card.querySelector("span.auct-id");
        console.log("🔍 idSpan element:", idSpan);
        if (!idSpan) {
            console.log("❌ No auction ID <span> found.");
            return null;
        }

        const idMatch = idSpan.innerText.match(/Auction Id:\s*(\d+)/i);
        console.log("🔍 idMatch result:", idMatch);
        const id = idMatch ? idMatch[1] : null;
        console.log("🆔 Auction ID:", id);
        if (!id) {
            console.log("❌ Auction ID not found in span text.");
            return null;
        }

        const titleEl = card.querySelector(`#ptitle_${id}`);
        console.log("🔍 titleEl element:", titleEl);
        const title = titleEl ? titleEl.innerText.trim() : 'Untitled';
        console.log("📖 Title:", title);
        const priceEl = card.querySelector(`.masprice${id}`);
        console.log("🔍 priceEl element:", priceEl);
        if (!priceEl) {
            console.log(`❌ Price element not found for Auction ID: ${id}. Check if the selector '.masprice${id}' is correct.`);
        }
        const price = priceEl ? priceEl.innerText.replace(/[^\d.]/g, '').trim() : '0.00';
        console.log("💲 Price:", price);

        const timeEl = card.querySelector(`.mys${id}`);
        console.log("🔍 timeEl element:", timeEl);
        if (!timeEl) {
            console.log(`❌ Time element not found for Auction ID: ${id}. Check if the selector '.mys${id}' is correct.`);
        }
        const timeRaw = timeEl ? timeEl.innerText : null;
        console.log("⏳ Raw Time:", timeRaw);
        const timeLeft = timeRaw || 'Unknown';
        console.log("⏳ Time Left:", timeLeft);

        const endTimeEl = card.querySelector(`#tim${id}`);
        console.log("🔍 endTimeEl element:", endTimeEl);
        if (!endTimeEl) {
            console.log(`❌ End Time element not found for Auction ID: ${id}. Check if the selector '#tim${id}' is correct.`);
        }
        const endTime = endTimeEl ? endTimeEl.value : 'N/A';
        console.log("📅 End Time:", endTime);

        const html = card.innerHTML;
        console.log("📜 Card HTML:", html);
        const status = html.includes('Winning') ? 'Winning'
            : html.includes('Losing') ? 'Losing'
            : 'Watching';
        console.log("📊 Status:", status);

        console.log(`✅ Extracted: [${id}] "${title}" - $${price} - Time: ${timeLeft} - Status: ${status}`);
        return { title, price, id, timeLeft, endTime, status };
    }

    function createRow({ title, price, id, timeLeft, endTime, status }) {
        console.log(`🧱 Creating row for ${id}`);
        const row = document.createElement('tr');
        row.style.backgroundColor = statusColors[status] || 'white';

        let isTargetKeyword = false;
        targetlist.forEach(keyword => {
            if (title.toLowerCase().includes(keyword.toLowerCase())) {
                isTargetKeyword = true;
            }
        });

        if (isTargetKeyword) {
            console.log(`🎯 Marking ${id} as TARGETLIST (Keyword Match)`);
            row.style.fontWeight = 'bold';
        }

        if (targetlist.includes(id)) {
            console.log(`🎯 Marking ${id} as TARGETLIST`);
            row.style.fontWeight = 'bold';
        }

        row.innerHTML = `
            <td><a href="https://www.slibuy.com/auction/${id}" target="_blank" title="${title}">${title.slice(0, 40)}${title.length > 40 ? '…' : ''}</a></td>
            <td>$${price}</td>
            <td>${timeLeft}</td>
            <td>${endTime}</td>
            <td>${status}</td>
        `;
        return row;
    }

    function injectUI() {
        const wrapper = document.createElement('div');
        wrapper.id = 'sli-summary-panel';
        wrapper.style = 'position:fixed;left:10px;top:10px;background:white;border:1px solid #ccc;padding:10px;z-index:9999;max-height:90vh;overflow:auto;font-size:13px;box-shadow:2px 2px 8px rgba(0,0,0,0.2)';
        wrapper.innerHTML = `
            <div style="margin-bottom:5px;">
                <button id="refresh-summary">🔄 Refresh</button>
                <button id="edit-blacklist">🛑 Blacklist</button>
                <button id="edit-targetlist">🎯 Targetlist</button>
            </div>
            <table id="sli-summary" border="1" cellpadding="5" style="border-collapse:collapse;width:100%;">
                <thead><tr><th>Title</th><th>Price</th><th>Time Left</th><th>End Time</th><th>Status</th></tr></thead>
                <tbody></tbody>
            </table>
        `;
        document.body.appendChild(wrapper);

        document.getElementById('refresh-summary').onclick = () => {
            console.log("🔁 Manual refresh clicked");
            loadData();
        };

        document.getElementById('edit-blacklist').onclick = () => {
            const input = prompt("Blacklist (comma-separated Auction IDs)", blacklist.join(','));
            if (input !== null) {
                blacklist = input.split(',').map(x => x.trim()).filter(Boolean);
                localStorage.setItem(BLACKLIST_KEY, JSON.stringify(blacklist));
                console.log("🛑 Blacklist updated:", blacklist);
                loadData();
            }
        };

        document.getElementById('edit-targetlist').onclick = () => {
            const input = prompt("Targetlist (comma-separated Auction IDs)", targetlist.join(','));
            if (input !== null) {
                targetlist = input.split(',').map(x => x.trim()).filter(Boolean);
                localStorage.setItem(TARGETLIST_KEY, JSON.stringify(targetlist));
                console.log("🎯 Targetlist updated:", targetlist);
                loadData();
            }
        };
    }

    function loadData() {
        console.log("🚀 Starting data extraction...");
        const tbody = document.querySelector('#sli-summary tbody');
        if (!tbody) return console.log("❌ Could not find summary table body");
        tbody.innerHTML = '';

        const cards = Array.from(document.querySelectorAll('.well.well-bg.list_view.clearfix'));
        console.log(`📦 Found ${cards.length} listing cards`);

        cards.forEach(card => {
            const data = extractData(card);
            if (!data) return;
            if (blacklist.includes(data.id)) {
                console.log(`🚫 Skipping blacklisted item ${data.id}`);
                return;
            }
            tbody.appendChild(createRow(data));
        });
        console.log("✅ Done rendering all rows.");
    }

    injectUI();
    setTimeout(() => {
        console.log("⏳ Running initial delayed load...");
        loadData();
    }, 3000);


})();