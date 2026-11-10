// map.js - choropleth of local areas with clinic markers (SVG, no tiles, so it
// works offline). Coordinates are WGS84 lon/lat; they are drawn with a local
// equirectangular projection, which is accurate at the scale of a health
// territory and does not depend on polygon winding order.
(function (root) {
  'use strict';
  const d3 = root.d3;

  function projector(features, width, maxHeight) {
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
    const visit = (c) => {
      if (typeof c[0] === 'number') {
        lonMin = Math.min(lonMin, c[0]); lonMax = Math.max(lonMax, c[0]);
        latMin = Math.min(latMin, c[1]); latMax = Math.max(latMax, c[1]);
      } else c.forEach(visit);
    };
    features.forEach((f) => visit(f.geometry.coordinates));
    const kx = Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
    const pad = 12;
    const dx = (lonMax - lonMin) * kx, dy = latMax - latMin;
    let height = Math.round((width - 2 * pad) * dy / dx + 2 * pad);
    height = Math.max(280, Math.min(maxHeight, height));
    const sc = Math.min((width - 2 * pad) / dx, (height - 2 * pad) / dy);
    const ox = (width - dx * sc) / 2, oy = (height - dy * sc) / 2;
    const xy = (lon, lat) => [ox + (lon - lonMin) * kx * sc, oy + (latMax - lat) * sc];
    const transform = d3.geoTransform({ point(lon, lat) { const p = xy(lon, lat); this.stream.point(p[0], p[1]); } });
    return { path: d3.geoPath(transform), xy, height };
  }

  // opts: { features, clinics, value(feature) -> number|NaN, color(value) -> css colour,
  //         suppressed(feature) -> bool, selectedId, label, onHover, onLeave, onSelect,
  //         clinicActive(clinic) -> bool, ariaValue(feature) -> string }
  function render(el, opts) {
    const width = Math.max(280, el.clientWidth || 600);
    const pr = projector(opts.features, width, opts.maxHeight || 560);
    d3.select(el).selectAll('*').remove();
    const svg = d3.select(el).append('svg').attr('class', 'map-svg').attr('width', width).attr('height', pr.height)
      .attr('viewBox', [0, 0, width, pr.height].join(' ')).attr('role', 'group').attr('aria-label', opts.label || 'Map');
    const defs = svg.append('defs');
    const pat = defs.append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 6).attr('height', 6).style('fill', 'var(--nodata)');
    pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).style('stroke', 'var(--hatch)').style('stroke-width', 1.5);

    const areas = svg.append('g').selectAll('path').data(opts.features).join('path')
      .attr('class', (f) => 'area' + (f.properties.area_id === opts.selectedId ? ' selected' : ''))
      .attr('d', pr.path)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (f) => opts.ariaValue(f))
      .style('fill', (f) => {
        if (opts.suppressed && opts.suppressed(f)) return 'url(#hatch)';
        const v = opts.value(f);
        return isNaN(v) ? 'var(--nodata)' : opts.color(v);
      })
      .on('mousemove', (event, f) => opts.onHover(f, event))
      .on('mouseleave', (event, f) => opts.onLeave(f, event))
      .on('click', (event, f) => opts.onSelect(f))
      .on('keydown', (event, f) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); opts.onSelect(f); }
      })
      .on('focus', (event, f) => opts.onFocus && opts.onFocus(f));
    // keep the selected outline on top
    areas.filter('.selected').raise();

    const g = svg.append('g').attr('aria-hidden', 'true');
    const clinics = g.selectAll('g.clinic').data(opts.clinics).join('g').attr('class', 'clinic')
      .attr('transform', (c) => { const p = pr.xy(c.lon, c.lat); return 'translate(' + p[0] + ',' + p[1] + ')'; });
    clinics.append('circle').attr('class', (c) => 'clinic-dot' + (opts.clinicActive(c) ? '' : ' dim'))
      .attr('r', (c) => 4 + 1.6 * Math.sqrt(c.providers.physician || 1));
    clinics.append('text').attr('class', 'clinic-label clinic-label-halo').attr('x', (c) => 7 + 1.6 * Math.sqrt(c.providers.physician || 1))
      .attr('y', 4).text((c) => c.id.replace(/^GMF-/, ''));
    clinics.append('text').attr('class', 'clinic-label').attr('x', (c) => 7 + 1.6 * Math.sqrt(c.providers.physician || 1))
      .attr('y', 4).style('opacity', (c) => opts.clinicActive(c) ? 1 : 0.45).text((c) => c.id.replace(/^GMF-/, ''));
    clinics.append('circle').attr('r', 12).attr('class', 'hit').style('pointer-events', 'all')
      .on('mousemove', (event, c) => opts.onClinicHover && opts.onClinicHover(c, event))
      .on('mouseleave', () => root.Charts.Tooltip.hide());

    return { svg, height: pr.height };
  }

  function setHovered(el, id) {
    d3.select(el).selectAll('path.area').classed('hovered', (f) => f.properties.area_id === id);
  }

  root.MapView = { render, setHovered };
}(this));
