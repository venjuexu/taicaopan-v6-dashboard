/* @台操盤V6 官方收盤價小工具。僅讀取 GitHub Pages 的公開 market-data.json。 */
(() => {
  'use strict';
  const target = document.querySelector('#view-overview .metrics');
  if (!target || document.getElementById('twsePublicPrices')) return;
  const box = document.createElement('article');
  box.id = 'twsePublicPrices';
  box.className = 'panel';
  box.style.marginBottom = '13px';
  const h = document.createElement('h2');
  h.textContent = '證交所官方收盤行情';
  h.style.margin = '0 0 5px';
  h.style.fontSize = '16px';
  const note = document.createElement('p');
  note.style.color = '#a0b2c9';
  note.style.fontSize = '12px';
  note.textContent = '資料讀取中，非即時行情';
  note.style.margin = '0 0 10px';
  const prices = document.createElement('div');
  prices.style.display = 'grid';
  prices.style.gridTemplateColumns = 'repeat(auto-fit,minmax(125px,1fr))';
  prices.style.gap = '8px';
  const button = document.createElement('button');
  button.textContent = '重新讀取收盤資料';
  button.className = 'button secondary';
  button.style.marginTop = '10px';
  button.style.fontSize = '12px';
  box.append(h, note, prices, button);
  target.insertAdjacentElement('afterend', box);

  const number = value => new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 2
  }).format(value);

  async function update() {
    note.textContent = '正在讀取已發布的收盤資料…';
    try {
      const url = new URL('market-data.json', document.baseURI);
      url.searchParams.set('refresh', String(Date.now()));
      const res = await fetch(url.href, { cache: 'no-store' });
      if (!res.ok) throw Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.source !== '臺灣證券交易所 OpenAPI / STOCK_DAY_ALL' ||
          !Array.isArray(data.quotes) || !/^\d{4}-\d{2}-\d{2}$/.test(data.session_date)) {
        throw Error('資料格式不完整');
      }
      prices.replaceChildren();
      for (const q of data.quotes) {
        if (!Number.isFinite(q.close) || q.close <= 0) continue;
        const card = document.createElement('div');
        card.style.cssText = 'background:#0b182b;border:1px solid #2b415d;border-radius:9px;padding:10px;';
        const name = document.createElement('div');
        name.style.color = '#b9cde5';
        name.style.fontSize = '11px';
        name.textContent = q.symbol + ' ' + q.name;
        const close = document.createElement('strong');
        close.style.display = 'block';
        close.style.fontSize = '19px';
        close.style.marginTop = '4px';
        close.textContent = number(q.close);
        const change = document.createElement('div');
        change.style.fontSize = '12px';
        change.style.marginTop = '3px';
        change.style.color = q.change > 0 ? '#ff798b' : q.change < 0 ? '#51ddba' : '#a0b2c9';
        change.textContent = Number.isFinite(q.change)
          ? '當日漲跌 ' + (q.change > 0 ? '+' : '') + number(q.change)
          : '當日漲跌未提供';
        card.append(name, close, change);
        prices.appendChild(card);
      }
      if (!prices.childElementCount) throw Error('本次沒有可顯示的股票');
      note.textContent = '交易日：' + data.session_date + ' ｜官方收盤資料，非盤中即時；不包含交易建議';
    } catch (err) {
      prices.replaceChildren();
      note.textContent = '官方收盤資料暫無法讀取（' + String(err.message || '未知原因') + '），請稍後再試';
    }
  }
  button.addEventListener('click', update);
  update();
})();
