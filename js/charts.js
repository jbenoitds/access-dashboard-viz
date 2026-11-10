// charts.js - small reusable D3 v6 chart components.
// Colours are CSS custom properties ("var(--s1)") so light / dark themes swap
// without redrawing logic. Every chart has a hover layer (tooltip).
(function (root) {
  'use strict';
  const d3 = root.d3;

  // ---------------------------------------------------------------- tooltip
  const Tooltip = {
    el: null,
    show(html, event) {
      if (!this.el) this.el = document.getElementById('tooltip');
      const el = this.el;
      el.innerHTML = html;
      el.classList.add('on');
      el.setAttribute('aria-hidden', 'false');
      const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
      el.style.left = Math.max(8, x) + 'px';
      el.style.top = Math.max(8, y) + 'px';
    },
    hide() {
      if (!this.el) return;
      this.el.classList.remove('on');
      this.el.setAttribute('aria-hidden', 'true');
    },
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function ttRow(label, value, color) {
    return '<div class="tt-row"><span>' + (color ? '<i class="tt-key" style="background:' + color + '"></i>' : '') +
      esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function width(el) { return Math.max(200, el.clientWidth || el.getBoundingClientRect().width || 300); }

  function svg(el, w, h, label) {
    d3.select(el).selectAll('*').remove();
    return d3.select(el).append('svg').attr('width', w).attr('height', h).attr('viewBox', [0, 0, w, h].join(' '))
      .attr('role', 'img').attr('aria-label', label || '');
  }

  // Rounded data-end bar path (4px radius at the end away from the baseline).
  function barPath(x, y, w, h, r, horizontal) {
    if (w <= 0 || h <= 0) return '';
    r = Math.min(r, horizontal ? w : h, horizontal ? h / 2 : w / 2);
    if (horizontal) { // baseline on the left, rounded on the right
      return 'M' + x + ',' + y + 'h' + (w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - 2 * r) +
        'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + 'h' + (r - w) + 'z';
    }
    return 'M' + x + ',' + (y + h) + 'v' + (r - h) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + 'h' + (w - 2 * r) +
      'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - r) + 'z';
  }

  // -------------------------------------------------------------- sparkline
  // values: array of numbers (NaN gaps allowed). One series, no legend.
  function sparkline(el, values, opts) {
    opts = opts || {};
    const w = width(el), h = opts.height || 34;
    const s = svg(el, w, h, opts.label);
    const ok = values.filter((v) => !isNaN(v));
    if (ok.length < 2) return;
    const x = d3.scaleLinear().domain([0, values.length - 1]).range([2, w - 4]);
    const ext = d3.extent(ok);
    const padY = (ext[1] - ext[0]) * 0.15 || Math.abs(ext[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([ext[0] - padY, ext[1] + padY]).range([h - 3, 3]);
    const line = d3.line().defined((v) => !isNaN(v)).x((v, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX);
    s.append('path').attr('d', line(values)).style('fill', 'none').style('stroke', opts.color || 'var(--s1)')
      .style('stroke-width', 2).style('stroke-linecap', 'round').style('stroke-linejoin', 'round');
    let last = values.length - 1;
    while (last > 0 && isNaN(values[last])) last--;
    s.append('circle').attr('cx', x(last)).attr('cy', y(values[last])).attr('r', 3)
      .style('fill', opts.color || 'var(--s1)').style('stroke', 'var(--surface)').style('stroke-width', 2);
    if (opts.tooltip) {
      const hit = s.append('rect').attr('class', 'hit').attr('width', w).attr('height', h);
      const dot = s.append('circle').attr('r', 4).style('fill', 'none').style('stroke', 'var(--ink)').style('stroke-width', 1.5).style('display', 'none');
      hit.on('mousemove', (event) => {
        const i = Math.max(0, Math.min(values.length - 1, Math.round(x.invert(d3.pointer(event)[0]))));
        if (isNaN(values[i])) { dot.style('display', 'none'); Tooltip.hide(); return; }
        dot.style('display', null).attr('cx', x(i)).attr('cy', y(values[i]));
        Tooltip.show(opts.tooltip(i), event);
      }).on('mouseleave', () => { dot.style('display', 'none'); Tooltip.hide(); });
    }
  }

  // ------------------------------------------------------- quintile columns
  // values[5] for Q1..Q5; colors[5]; format(v). Labels Q1 and Q5 directly.
  function quintileBars(el, values, opts) {
    const w = width(el), h = opts.height || 120;
    const m = { t: 16, r: 4, b: 18, l: 4 };
    const s = svg(el, w, h, opts.label);
    const x = d3.scaleBand().domain(d3.range(5)).range([m.l, w - m.r]).paddingInner(0.28).paddingOuter(0.1);
    const ok = values.filter((v) => !isNaN(v));
    const max = ok.length ? d3.max(ok) : 1;
    const y = d3.scaleLinear().domain([0, max * 1.08 || 1]).range([h - m.b, m.t]);
    s.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--axis)');
    const data = values.map((v, i) => ({ i, v }));
    const g = s.selectAll('g.b').data(data).join('g').attr('class', 'b');
    const cx = (d) => x(d.i) + x.bandwidth() / 2;
    g.append('path').attr('d', (d) => isNaN(d.v) ? '' : barPath(x(d.i), y(d.v), x.bandwidth(), y(0) - y(d.v), 4, false))
      .style('fill', (d) => opts.colors[d.i]);
    g.append('text').attr('x', cx).attr('y', h - 4).attr('text-anchor', 'middle')
      .attr('class', 'annot').style('fill', 'var(--muted)').text((d) => 'Q' + (d.i + 1));
    g.filter((d) => (d.i === 0 || d.i === 4) && !isNaN(d.v)).append('text')
      .attr('x', cx).attr('y', (d) => y(d.v) - 4).attr('text-anchor', 'middle').attr('class', 'annot')
      .style('font-weight', 600).style('fill', 'var(--ink)').text((d) => opts.format(d.v));
    g.append('rect').attr('class', 'hit').attr('x', (d) => x(d.i) - 2).attr('width', x.bandwidth() + 4)
      .attr('y', m.t - 10).attr('height', h - m.t - m.b + 10)
      .on('mousemove', (event, d) => {
        Tooltip.show('<div class="tt-title">' + esc(opts.title) + '</div>' + ttRow('Q' + (d.i + 1), opts.format(d.v), opts.colors[d.i]) +
          (opts.extra ? opts.extra(d.i) : ''), event);
      })
      .on('mouseleave', () => Tooltip.hide());
  }

  // ------------------------------------------------------------- histogram
  // counts[d] for d = 0..max (last = overflow). Shows share of appointments.
  function histogram(el, counts, opts) {
    const w = width(el), h = opts.height || 260;
    const m = { t: 28, r: 12, b: 34, l: 40 };
    const s = svg(el, w, h, opts.label);
    const shown = opts.showDays; // 0..showDays-1 individually, then one "showDays+" bar
    const total = d3.sum(counts);
    const bins = [];
    for (let d = 0; d < shown; d++) bins.push({ k: d, label: String(d), n: counts[d] || 0 });
    bins.push({ k: shown, label: shown + '+', n: d3.sum(counts.slice(shown)) });
    bins.forEach((b) => { b.p = total ? b.n / total : 0; });
    const x = d3.scaleBand().domain(bins.map((b) => b.k)).range([m.l, w - m.r]).paddingInner(0.18);
    const y = d3.scaleLinear().domain([0, (d3.max(bins, (b) => b.p) || 0.1) * 1.1]).nice().range([h - m.b, m.t]);
    s.append('g').attr('class', 'gridline').attr('transform', 'translate(' + m.l + ',0)')
      .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat(''));
    s.append('g').attr('class', 'axis').attr('transform', 'translate(' + m.l + ',0)')
      .call(d3.axisLeft(y).ticks(4).tickFormat((v) => opts.pct(v, 0)).tickSize(0).tickPadding(6)).call((g) => g.select('.domain').remove());
    const tickEvery = w < 420 ? 14 : shown > 40 ? 7 : 5;
    s.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + (h - m.b) + ')')
      .call(d3.axisBottom(x).tickValues(bins.filter((b) => b.k === shown || (b.k % tickEvery === 0 && shown - b.k >= tickEvery / 2)).map((b) => b.k))
        .tickFormat((k) => k === shown ? shown + '+' : k).tickSizeOuter(0));
    s.append('text').attr('class', 'annot').attr('x', (m.l + w - m.r) / 2).attr('y', h).attr('text-anchor', 'middle').text(opts.xTitle);
    s.selectAll('path.bar').data(bins).join('path').attr('class', 'bar')
      .attr('d', (b) => barPath(x(b.k), y(b.p), x.bandwidth(), y(0) - y(b.p), Math.min(4, x.bandwidth() / 2), false))
      .style('fill', (b) => b.k === shown ? 'var(--seq2)' : 'var(--s1)');
    const mark = (v, cls, text, dy) => {
      if (isNaN(v)) return;
      const px = v >= shown ? x(shown) + x.bandwidth() / 2 : x(Math.floor(v)) + x.bandwidth() * (0.5 + (v - Math.floor(v)));
      s.append('line').attr('class', 'annot-line ' + cls).attr('x1', px).attr('x2', px).attr('y1', m.t - 4 + dy).attr('y2', h - m.b);
      s.append('text').attr('class', 'annot').attr('x', px + 4).attr('y', m.t + dy).style('font-weight', 600).text(text);
    };
    mark(opts.median, 'median', opts.medianLabel, -10);
    mark(opts.p90, 'p90', opts.p90Label, 4);
    s.selectAll('rect.hit').data(bins).join('rect').attr('class', 'hit').attr('x', (b) => x(b.k)).attr('width', x.step())
      .attr('y', m.t).attr('height', h - m.t - m.b)
      .on('mousemove', (event, b) => Tooltip.show(opts.tooltip(b, total), event))
      .on('mouseleave', () => Tooltip.hide());
  }

  // ------------------------------------------------------------------ lines
  // opts.x: array of x values (numbers or Dates), shared by all series
  // opts.series: [{ key, label, color, values: [...], emph: bool }]
  function lines(el, opts) {
    const w = width(el), h = opts.height || 260;
    const m = { t: 12, r: 16, b: opts.xTitle ? 34 : 26, l: 44 };
    const s = svg(el, w, h, opts.label);
    const isTime = opts.x.length && opts.x[0] instanceof Date;
    const x = (isTime ? d3.scaleUtc() : d3.scaleLinear()).domain(d3.extent(opts.x)).range([m.l, w - m.r]);
    const all = [];
    opts.series.forEach((se) => se.values.forEach((v) => { if (!isNaN(v)) all.push(v); }));
    let yDomain = opts.yDomain || [opts.zero === false ? d3.min(all) : Math.min(0, d3.min(all) || 0), d3.max(all) || 1];
    if (!opts.yDomain && yDomain[1] === yDomain[0]) yDomain = [yDomain[0] - 1, yDomain[1] + 1];
    const y = d3.scaleLinear().domain(yDomain).nice().range([h - m.b, m.t]);
    s.append('g').attr('class', 'gridline').attr('transform', 'translate(' + m.l + ',0)')
      .call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat(''));
    s.append('g').attr('class', 'axis').attr('transform', 'translate(' + m.l + ',0)')
      .call(d3.axisLeft(y).ticks(5).tickFormat(opts.yFormat).tickSize(0).tickPadding(6)).call((g) => g.select('.domain').remove());
    const xAxis = d3.axisBottom(x).ticks(Math.max(2, Math.min(opts.x.length, Math.floor((w - 60) / 70)))).tickSizeOuter(0);
    if (opts.xFormat) xAxis.tickFormat(opts.xFormat);
    s.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + (h - m.b) + ')').call(xAxis);
    if (opts.xTitle) s.append('text').attr('class', 'annot').attr('x', (m.l + w - m.r) / 2).attr('y', h).attr('text-anchor', 'middle').text(opts.xTitle);
    const line = d3.line().defined((v) => !isNaN(v)).x((v, i) => x(opts.x[i])).y((v) => y(v));
    if (opts.curve !== 'step') line.curve(d3.curveMonotoneX); else line.curve(d3.curveStepAfter);
    // muted series first, emphasised on top
    const order = opts.series.slice().sort((a, b) => (a.emph === b.emph ? 0 : a.emph ? 1 : -1));
    s.selectAll('path.series').data(order).join('path').attr('class', 'series').attr('d', (se) => line(se.values))
      .style('fill', 'none').style('stroke', (se) => se.color).style('stroke-width', (se) => se.muted ? 1.5 : 2)
      .style('stroke-linejoin', 'round').style('stroke-linecap', 'round');
    if (opts.targets) {
      opts.targets.forEach((tg) => {
        s.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(tg.value)).attr('y2', y(tg.value))
          .style('stroke', 'var(--ink-2)').style('stroke-width', 1);
        s.append('text').attr('class', 'annot').attr('x', w - m.r).attr('y', y(tg.value) - 4).attr('text-anchor', 'end').text(tg.label);
      });
    }
    const cross = s.append('line').attr('class', 'crosshair').attr('y1', m.t).attr('y2', h - m.b).style('display', 'none');
    const dots = s.append('g');
    s.append('rect').attr('class', 'hit').attr('x', m.l).attr('y', m.t).attr('width', w - m.l - m.r).attr('height', h - m.t - m.b)
      .on('mousemove', (event) => {
        const px = d3.pointer(event)[0];
        const xv = x.invert(px);
        let i = d3.bisectCenter ? d3.bisectCenter(opts.x.map(Number), +xv) : 0;
        i = Math.max(0, Math.min(opts.x.length - 1, i));
        const cx = x(opts.x[i]);
        cross.style('display', null).attr('x1', cx).attr('x2', cx);
        const pts = order.filter((se) => !isNaN(se.values[i]));
        dots.selectAll('circle').data(pts).join('circle').attr('cx', cx).attr('cy', (se) => y(se.values[i])).attr('r', 4)
          .style('fill', (se) => se.color).style('stroke', 'var(--surface)').style('stroke-width', 2);
        const rows = opts.series.filter((se) => !isNaN(se.values[i]) && !se.hideInTooltip)
          .slice().sort((a, b) => b.values[i] - a.values[i])
          .map((se) => ttRow(se.label, opts.yFormatTip ? opts.yFormatTip(se.values[i]) : opts.yFormat(se.values[i]), se.color)).join('');
        Tooltip.show('<div class="tt-title">' + esc(opts.xFormatTip ? opts.xFormatTip(opts.x[i]) : opts.x[i]) + '</div>' + rows, event);
      })
      .on('mouseleave', () => { cross.style('display', 'none'); dots.selectAll('*').remove(); Tooltip.hide(); });
    if (!all.length) {
      s.append('text').attr('class', 'annot').attr('x', w / 2).attr('y', h / 2).attr('text-anchor', 'middle').text(opts.emptyText || '–');
    }
  }

  // ------------------------------------------------- horizontal stacked bars
  // rows: [{ key, label, values: [..per key..], marker: number|undefined }]
  // keys: [{ key, label, color }]. opts.percent: rows are normalised to 100%.
  function hstack(el, rows, keys, opts) {
    const w = width(el);
    const rowH = opts.rowHeight || 20, gap = opts.rowGap || 8;
    const m = { t: 6, r: 16, b: 26, l: opts.labelWidth || 110 };
    const h = m.t + m.b + rows.length * (rowH + gap);
    const s = svg(el, w, h, opts.label);
    const totals = rows.map((r) => d3.sum(r.values));
    const max = opts.percent ? 1 : d3.max(rows, (r, i) => Math.max(totals[i], r.marker || 0)) || 1;
    const x = d3.scaleLinear().domain([0, max]).nice().range([m.l, w - m.r]);
    s.append('g').attr('class', 'gridline').attr('transform', 'translate(0,' + (h - m.b) + ')')
      .call(d3.axisBottom(x).ticks(5).tickSize(-(h - m.t - m.b)).tickFormat(''));
    s.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + (h - m.b) + ')')
      .call(d3.axisBottom(x).ticks(5).tickFormat(opts.xFormat).tickSizeOuter(0));
    rows.forEach((r, ri) => {
      const y0 = m.t + ri * (rowH + gap);
      const g = s.append('g');
      g.append('text').attr('class', 'annot').attr('x', m.l - 8).attr('y', y0 + rowH / 2 + 4).attr('text-anchor', 'end')
        .style('fill', r.emph === false ? 'var(--muted)' : 'var(--ink-2)').text(r.label);
      const total = totals[ri];
      let acc = 0;
      const segs = [];
      r.values.forEach((v, ki) => {
        const val = opts.percent ? (total ? v / total : 0) : v;
        segs.push({ ki, x0: acc, x1: acc + val, raw: v });
        acc += val;
      });
      const visible = segs.filter((sg) => sg.x1 > sg.x0);
      visible.forEach((sg, vi) => {
        const last = vi === visible.length - 1;
        const xa = x(sg.x0) + (vi > 0 ? 1 : 0), xb = x(sg.x1) - (last ? 0 : 1); // 2px gap between segments
        g.append('path').attr('d', last ? barPath(xa, y0, xb - xa, rowH, 4, true) : 'M' + xa + ',' + y0 + 'h' + Math.max(0, xb - xa) + 'v' + rowH + 'h' + (-Math.max(0, xb - xa)) + 'z')
          .style('fill', keys[sg.ki].color).style('opacity', r.emph === false ? 0.45 : 1);
      });
      if (r.marker !== undefined && r.marker !== null && !isNaN(r.marker)) {
        const mx = x(r.marker);
        g.append('line').attr('x1', mx).attr('x2', mx).attr('y1', y0 - 3).attr('y2', y0 + rowH + 3)
          .style('stroke', 'var(--ink)').style('stroke-width', 2.5).style('stroke-linecap', 'round');
      }
      g.append('rect').attr('class', 'hit').attr('x', 0).attr('y', y0 - gap / 2).attr('width', w).attr('height', rowH + gap)
        .on('mousemove', (event) => Tooltip.show(opts.tooltip(r, segs, total), event))
        .on('mouseleave', () => Tooltip.hide());
    });
  }

  function legend(el, items) {
    el.innerHTML = items.map((it) => {
      const key = it.type === 'line' ? '<i class="line" style="background:' + it.color + '"></i>'
        : it.type === 'ring' ? '<i class="ring"></i>'
          : it.type === 'hatch' ? '<i class="hatch"></i>'
            : it.type === 'tick' ? '<i class="line" style="width:3px;height:14px;background:var(--ink)"></i>'
              : '<i class="dot" style="background:' + it.color + ';border-radius:2px"></i>';
      return '<span class="item">' + key + esc(it.label) + '</span>';
    }).join('');
  }

  root.Charts = { Tooltip, esc, ttRow, sparkline, quintileBars, histogram, lines, hstack, legend, barPath };
}(this));
