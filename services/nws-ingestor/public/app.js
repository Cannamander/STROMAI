(function () {
  const LOG_ZIP_SAMPLE_SIZE = 10;
  let token = null;
  let config = {};

  async function getConfig() {
    const r = await fetch('/config.json');
    config = await r.json();
    return config;
  }

  function apiHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path.startsWith('http') ? path : (config.apiBase || '') + path, {
      ...opts,
      headers: { ...apiHeaders(), ...opts.headers },
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
    const ct = res.headers.get('Content-Type');
    if (ct && ct.includes('application/json')) return res.json();
    return res.text();
  }

  function showPage(id) {
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    const section = document.getElementById(id);
    if (section) section.classList.add('active');
    const link = document.querySelector('nav a[data-page="' + id + '"]');
    if (link) link.classList.add('active');
  }

  function buildCopyBlock(alert) {
    const zips = alert.zips || [];
    const sampleSize = Math.min(LOG_ZIP_SAMPLE_SIZE, zips.length);
    const zipsSample = zips.slice(0, sampleSize).join(', ');
    const includeAllZips = zips.length <= 250;
    const lines = [
      '---',
      'AI-STORMS ALERT',
      'alert_id: ' + (alert.alert_id || ''),
      'event: ' + (alert.event || ''),
      'severity: ' + (alert.severity || ''),
      'window: ' + (alert.effective || '') + ' → ' + (alert.expires || ''),
      'states: ' + ((alert.impacted_states && alert.impacted_states.length) ? alert.impacted_states.join(',') : '—'),
      'zips_count: ' + (alert.zip_count ?? zips.length),
      'zips_sample: ' + (zipsSample || '—'),
      'lsr_count: ' + (alert.lsr_match_count ?? 0),
      'hail_max_inches: ' + (alert.hail_max_inches ?? null),
      'wind_max_mph: ' + (alert.wind_max_mph ?? null),
      'tornado_count: ' + (alert.tornado_count ?? 0),
      'flood_count: ' + (alert.flood_count ?? 0),
      'damage_keyword_hits: ' + (alert.damage_keyword_hits ?? 0),
      'interesting: hail=' + (alert.interesting_hail ? 'T' : 'F') + ' wind=' + (alert.interesting_wind ? 'T' : 'F') + ' rare_freeze=' + (alert.interesting_rare_freeze ? 'T' : 'F') + ' any=' + (alert.interesting_any ? 'T' : 'F'),
      'damage_score: ' + (alert.damage_score ?? 0),
    ];
    if (includeAllZips) {
      lines.push('ALL_ZIPS: ' + zips.join(','));
    } else if (zips.length > 250) {
      lines.push('(zip_count > 250 — export CSV for full list)');
    }
    lines.push('---');
    return lines.join('\n');
  }

  let currentAlert = null;
  let stateFilter = ''; // single state from chip click (for breadcrumb)
  let columnSort = null; // { sort_by, sort_dir } or null to use preset
  let drawerState = null; // state code when drawer is open, or null
  let detailBackToPage = 'dashboard'; // 'dashboard' | 'map'
  let mapInited = false;
  let mapInstance = null;
  let mapLayers = { base: null, radar: null, alerts: null, zips: null };
  let mapCache = { alerts: null, zips: null, meta: null, cacheAt: 0 };
  let mapRadarTime = null; // ISO string for WMS TIME param
  let mapRadarPlaying = false;
  let mapRadarIntervalId = null;
  const MAP_CACHE_TTL_MS = 45000; // 45s

  function formatExpiresIn(expires) {
    if (!expires) return '—';
    var t = new Date(expires).getTime();
    var now = Date.now();
    if (t <= now) return '—';
    var min = Math.floor((t - now) / 60000);
    if (min < 60) return min + 'm';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  function zipBucketLabel(zipCount) {
    var n = zipCount != null ? Number(zipCount) : 0;
    if (n <= 50) return { label: 'Small', class: 'bucket-small' };
    if (n <= 200) return { label: 'Medium', class: 'bucket-medium' };
    if (n <= 1000) return { label: 'Large', class: 'bucket-large' };
    return { label: 'Massive', class: 'bucket-massive' };
  }

  function buildParams() {
    var params = new URLSearchParams();
    params.set('sort_mode', (document.getElementById('sort-mode') && document.getElementById('sort-mode').value) || 'action');
    if (columnSort && columnSort.sort_by) {
      params.set('sort_by', columnSort.sort_by);
      params.set('sort_dir', columnSort.sort_dir || 'desc');
    }
    var state = stateFilter || (document.getElementById('filter-state') && document.getElementById('filter-state').value.trim());
    if (state) params.set('state', state.toUpperCase());
    if (document.getElementById('filter-active') && document.getElementById('filter-active').checked) params.set('active', 'true');
    if (document.getElementById('filter-since-last-ingest') && document.getElementById('filter-since-last-ingest').checked) params.set('since_last_ingest', 'true');
    else params.set('since_last_ingest', 'false');
    if (document.getElementById('filter-warnings-only') && document.getElementById('filter-warnings-only').checked) params.set('class', 'warning');
    if (document.getElementById('filter-interesting-only') && document.getElementById('filter-interesting-only').checked) params.set('interesting', 'true');
    if (document.getElementById('filter-lsr-only') && document.getElementById('filter-lsr-only').checked) params.set('lsr_present', 'true');
    if (document.getElementById('filter-hide-geom-missing') && document.getElementById('filter-hide-geom-missing').checked) params.set('geom_present', 'true');
    var maxZip = document.getElementById('filter-max-zip-count') && document.getElementById('filter-max-zip-count').value;
    if (maxZip) params.set('max_zip_count', maxZip);
    var maxArea = document.getElementById('filter-max-area') && document.getElementById('filter-max-area').value;
    if (maxArea) params.set('max_area_sq_miles', maxArea);
    return params;
  }

  function updateBreadcrumb() {
    var el = document.getElementById('breadcrumb');
    if (!el) return;
    if (stateFilter) {
      el.innerHTML = '<a href="#" id="breadcrumb-all">All Alerts</a> &gt; ' + escapeHtml(stateFilter);
      var all = document.getElementById('breadcrumb-all');
      if (all) all.addEventListener('click', function (e) { e.preventDefault(); stateFilter = ''; document.getElementById('filter-state').value = ''; updateBreadcrumb(); loadAlerts(); });
    } else {
      el.textContent = 'All Alerts';
    }
  }

  function syncDrawerUrl() {
    var params = new URLSearchParams(window.location.search);
    if (drawerState) {
      params.set('state', drawerState);
      params.set('state_drawer', '1');
    } else {
      params.delete('state_drawer');
    }
    var qs = params.toString();
    var url = qs ? window.location.pathname + '?' + qs : window.location.pathname;
    if (window.history && window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function openDrawer(stateCode) {
    var state = (stateCode || '').trim().toUpperCase();
    if (!state) return;
    drawerState = state;
    stateFilter = state;
    var stateEl = document.getElementById('filter-state');
    if (stateEl) stateEl.value = state;
    updateBreadcrumb();
    loadAlerts(); // refresh main table to show state filter
    syncDrawerUrl();
    var overlay = document.getElementById('state-drawer-overlay');
    var panel = document.getElementById('state-drawer-panel');
    var title = document.getElementById('drawer-title');
    if (overlay) overlay.classList.add('open');
    if (panel) { panel.style.display = 'flex'; panel.setAttribute('aria-hidden', 'false'); }
    if (title) title.textContent = 'State: ' + state;
    document.querySelectorAll('.drawer-tabs button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-drawer-tab') === 'overview');
    });
    document.querySelectorAll('.drawer-body .tab-pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'drawer-tab-overview');
    });
    loadDrawerTab('overview');
  }

  function closeDrawer() {
    drawerState = null;
    syncDrawerUrl();
    var overlay = document.getElementById('state-drawer-overlay');
    var panel = document.getElementById('state-drawer-panel');
    if (overlay) overlay.classList.remove('open');
    if (panel) { panel.style.display = 'none'; panel.setAttribute('aria-hidden', 'true'); }
  }

  async function loadDrawerTab(tabId) {
    if (!drawerState) return;
    var state = drawerState;
    if (tabId === 'overview') {
      try {
        var summary = await api('/v1/states/' + encodeURIComponent(state) + '/summary');
        var tiles = document.getElementById('drawer-summary-tiles');
        if (tiles) {
          var c = summary.counts || {};
          tiles.innerHTML =
            '<div class="summary-tile"><span class="value">' + (c.active_alerts || 0) + '</span><br/>Active alerts</div>' +
            '<div class="summary-tile"><span class="value">' + (c.warnings || 0) + '</span><br/>Warnings</div>' +
            '<div class="summary-tile"><span class="value">' + (c.interesting || 0) + '</span><br/>Interesting</div>' +
            '<div class="summary-tile"><span class="value">' + (c.lsr_total || 0) + '</span><br/>LSR total</div>' +
            '<div class="summary-tile"><span class="value">' + (c.deliveries_queued || 0) + '</span><br/>Queued</div>' +
            '<div class="summary-tile"><span class="value">' + (c.deliveries_failed || 0) + '</span><br/>Failed</div>';
        }
        var eventsEl = document.getElementById('drawer-top-events');
        if (eventsEl) {
          eventsEl.innerHTML = (summary.top_events || []).map(function (e) { return '<li>' + escapeHtml(e.event || '—') + ' (' + e.count + ')</li>'; }).join('') || '<li>—</li>';
        }
        var alertsEl = document.getElementById('drawer-top-alerts');
        if (alertsEl) {
          alertsEl.innerHTML = (summary.top_alerts || []).map(function (a) {
            return '<li><a href="#" class="drawer-alert-link" data-id="' + escapeHtml(a.alert_id) + '">' + escapeHtml(a.event || '—') + ' (score ' + a.score + ')</a></li>';
          }).join('') || '<li>—</li>';
          alertsEl.querySelectorAll('.drawer-alert-link').forEach(function (a) {
            a.addEventListener('click', function (e) { e.preventDefault(); closeDrawer(); openDetail(a.getAttribute('data-id')); });
          });
        }
      } catch (err) {
        if (tiles) tiles.innerHTML = '<div class="summary-tile">Error: ' + escapeHtml(err.message) + '</div>';
      }
    } else if (tabId === 'alerts') {
      try {
        var sortMode = (document.getElementById('sort-mode') && document.getElementById('sort-mode').value) || 'action';
        var alertsData = await api('/v1/states/' + encodeURIComponent(state) + '/alerts?sort_mode=' + encodeURIComponent(sortMode));
        var alerts = alertsData.alerts || [];
        var tbody = document.getElementById('drawer-alerts-tbody');
        if (tbody) {
          tbody.innerHTML = alerts.map(function (a) {
            var geom = a.geom_present ? 'Y (' + (a.geo_method || '') + ')' : 'N';
            var exp = formatExpiresIn(a.expires);
            return '<tr><td>' + escapeHtml(a.event || '—') + '</td><td>' + escapeHtml((a.alert_class || 'other') + '') + '</td><td>' + (a.zip_count || 0) + '</td><td>' + escapeHtml(geom) + '</td><td>' + escapeHtml(exp) + '</td><td>' + (a.lsr_match_count || 0) + '</td><td>' + (a.damage_score || 0) + '</td><td><button type="button" class="row-view-btn" data-id="' + escapeHtml(a.alert_id) + '">View</button></td></tr>';
          }).join('');
          tbody.querySelectorAll('.row-view-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { closeDrawer(); openDetail(btn.getAttribute('data-id')); });
          });
        }
      } catch (err) {
        var tbody = document.getElementById('drawer-alerts-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">Error: ' + escapeHtml(err.message) + '</td></tr>';
      }
    } else if (tabId === 'places') {
      try {
        var placesData = await api('/v1/states/' + encodeURIComponent(state) + '/places');
        var lsrTbody = document.getElementById('drawer-lsr-places-tbody');
        if (lsrTbody) {
          lsrTbody.innerHTML = (placesData.lsr_places || []).map(function (p) {
            var last = p.last_seen_at ? new Date(p.last_seen_at).toLocaleString() : '—';
            var confClass = p.confidence === 'HIGH' ? 'confidence-high' : 'confidence-medium';
            return '<tr><td>' + escapeHtml(p.place) + '</td><td>' + p.obs_count + '</td><td>' + (p.hail_max_inches != null ? p.hail_max_inches : '—') + '</td><td>' + (p.wind_max_mph != null ? p.wind_max_mph : '—') + '</td><td>' + (p.tornado_count || 0) + '</td><td>' + escapeHtml(last) + '</td><td class="' + confClass + '">' + escapeHtml(p.confidence || '') + '</td></tr>';
          }).join('') || '<tr><td colspan="7">No LSR places</td></tr>';
        }
        var areaList = document.getElementById('drawer-area-desc-tokens');
        if (areaList) {
          areaList.innerHTML = (placesData.area_desc_tokens || []).map(function (t) {
            return '<li>' + escapeHtml(t.token) + ' <span class="confidence-low">(' + t.alert_count + ' alerts)</span></li>';
          }).join('') || '<li>—</li>';
        }
      } catch (err) {
        var lsrTbody = document.getElementById('drawer-lsr-places-tbody');
        if (lsrTbody) lsrTbody.innerHTML = '<tr><td colspan="7">Error: ' + escapeHtml(err.message) + '</td></tr>';
      }
    } else if (tabId === 'outbox') {
      try {
        var outboxData = await api('/v1/states/' + encodeURIComponent(state) + '/outbox');
        var outbox = outboxData.outbox || [];
        var tbody = document.getElementById('drawer-outbox-tbody');
        if (tbody) {
          tbody.innerHTML = outbox.map(function (o) {
            var zipCount = (o.payload && o.payload.impacted_zips && o.payload.impacted_zips.length) || 0;
            return '<tr><td>' + escapeHtml(o.status || '') + '</td><td>' + escapeHtml(String(o.created_at || '')) + '</td><td>' + escapeHtml(o.destination || '') + '</td><td>' + zipCount + '</td><td>' + (o.attempt_count || 0) + '</td><td>' + escapeHtml((o.last_error || '').slice(0, 80)) + '</td><td></td></tr>';
          }).join('') || '<tr><td colspan="7">No outbox entries</td></tr>';
        }
      } catch (err) {
        var tbody = document.getElementById('drawer-outbox-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7">Error: ' + escapeHtml(err.message) + '</td></tr>';
      }
    }
  }

  function getMapFilters() {
    var stateEl = document.getElementById('map-states');
    var states = (stateEl && stateEl.value) ? stateEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var warningsOnly = document.getElementById('map-warnings-only') && document.getElementById('map-warnings-only').checked;
    var interestingOnly = document.getElementById('map-interesting-only') && document.getElementById('map-interesting-only').checked;
    var minScore = document.getElementById('map-min-score') ? parseInt(document.getElementById('map-min-score').value, 10) : 0;
    var sinceHours = document.getElementById('map-since-hours') ? parseInt(document.getElementById('map-since-hours').value, 10) : 48;
    var sinceLastIngest = document.getElementById('map-since-last-ingest') && document.getElementById('map-since-last-ingest').checked;
    var preferPolygons = document.getElementById('map-prefer-polygons') && document.getElementById('map-prefer-polygons').checked;
    return { states, warningsOnly, interestingOnly, minScore: isNaN(minScore) ? 0 : minScore, sinceHours: isNaN(sinceHours) ? 48 : sinceHours, sinceLastIngest, preferPolygons };
  }

  function buildMapParams(filters, bbox) {
    var params = new URLSearchParams();
    if (filters.states.length) params.set('states', filters.states.join(','));
    params.set('since_hours', String(filters.sinceHours));
    if (filters.warningsOnly) params.set('warnings_only', 'true');
    if (filters.interestingOnly) params.set('interesting_only', 'true');
    params.set('min_score', String(filters.minScore));
    params.set('since_last_ingest', filters.sinceLastIngest ? 'true' : 'false');
    if (filters.preferPolygons) params.set('prefer_polygons', 'true');
    if (bbox && bbox.length === 4) params.set('bbox', bbox.join(','));
    return params;
  }

  function wmsTileLayer(baseUrl, options) {
    var layers = options.layers || '';
    var format = options.format || 'image/png';
    var transparent = options.transparent !== false;
    var opacity = options.opacity != null ? options.opacity : 1;
    var version = options.version || '1.1.1';
    var timeParam = options.time ? '&time=' + encodeURIComponent(options.time) : '';
    var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
    var base = baseUrl + sep + 'service=WMS&request=GetMap&version=' + version + '&layers=' + encodeURIComponent(layers) + '&format=' + encodeURIComponent(format) + '&transparent=' + (transparent ? 'true' : 'false') + '&width=256&height=256&srs=EPSG%3A4326' + timeParam + '&bbox=';
    return L.tileLayer('', {
      attribution: options.attribution || '',
      opacity: opacity,
      maxZoom: options.maxZoom || 18,
      getTileUrl: function (tilePoint) {
        var map = this._map;
        if (!map) return '';
        var nw = map.unproject(L.point(tilePoint.x * 256, tilePoint.y * 256), tilePoint.z);
        var se = map.unproject(L.point((tilePoint.x + 1) * 256, (tilePoint.y + 1) * 256), tilePoint.z);
        var bbox = [ nw.lng, se.lat, se.lng, nw.lat ].join(',');
        return base + encodeURIComponent(bbox);
      },
    });
  }

  function initMapIfNeeded() {
    if (mapInited || !window.L) return;
    var container = document.getElementById('map-container');
    if (!container || !container.offsetParent) return;
    mapInstance = L.map('map-container').setView([39.5, -98.5], 4);
    mapLayers.base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
    mapInited = true;
  }

  async function loadMapData() {
    var filters = getMapFilters();
    var bbox = null;
    if (mapInstance) {
      var bounds = mapInstance.getBounds();
      if (bounds) {
        bbox = [ bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth() ];
      }
    }
    var now = Date.now();
    if (mapCache.meta && now - mapCache.cacheAt < MAP_CACHE_TTL_MS && mapCache.filtersKey === JSON.stringify(filters)) {
      return { meta: mapCache.meta, alerts: mapCache.alerts, zips: mapCache.zips };
    }
    var statesParam = filters.states.length ? '&states=' + encodeURIComponent(filters.states.join(',')) : '';
    var meta = await api('/v1/map/meta' + (filters.states.length ? '?states=' + encodeURIComponent(filters.states.join(',')) : ''));
    var alertsUrl = '/v1/map/alerts?' + buildMapParams(filters, bbox).toString();
    var zipsUrl = '/v1/map/zips?' + buildMapParams(filters, bbox).toString();
    var alerts = await api(alertsUrl);
    var zips = await api(zipsUrl);
    mapCache = { meta, alerts, zips, filtersKey: JSON.stringify(filters), cacheAt: now };
    return { meta, alerts, zips };
  }

  function addMapLayers(data, filters) {
    if (!mapInstance) return;
    var showBase = document.getElementById('map-layer-base') && document.getElementById('map-layer-base').checked;
    if (mapLayers.base) {
      if (!showBase) { mapInstance.removeLayer(mapLayers.base); mapLayers.base = null; }
    }
    if (showBase && !mapLayers.base) {
      mapLayers.base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
    }
    if (mapLayers.alerts) { mapInstance.removeLayer(mapLayers.alerts); mapLayers.alerts = null; }
    if (mapLayers.zips) { mapInstance.removeLayer(mapLayers.zips); mapLayers.zips = null; }
    if (mapLayers.radar) { mapInstance.removeLayer(mapLayers.radar); mapLayers.radar = null; }

    var showAlerts = document.getElementById('map-layer-alerts') && document.getElementById('map-layer-alerts').checked;
    var showZips = document.getElementById('map-layer-zips') && document.getElementById('map-layer-zips').checked;
    var showRadar = document.getElementById('map-layer-radar') && document.getElementById('map-layer-radar').checked;
    var radarOpacity = (document.getElementById('map-radar-opacity') && parseInt(document.getElementById('map-radar-opacity').value, 10)) || 70;

    if (showAlerts && data.alerts && data.alerts.features && data.alerts.features.length) {
      mapLayers.alerts = L.geoJSON(data.alerts, {
        style: function () { return { color: '#f59e0b', weight: 2, fillOpacity: 0.2 }; },
        onEachFeature: function (feature, layer) {
          var p = feature.properties || {};
          var eventName = p.event || 'Alert';
          var headline = (p.headline || '').trim();
          var tooltipText = headline ? (eventName + ': ' + headline) : eventName;
          if (tooltipText.length > 300) tooltipText = tooltipText.slice(0, 297) + '…';
          layer.bindTooltip(tooltipText, { sticky: true, direction: 'top', className: 'map-polygon-tooltip', maxWidth: 320 });
          layer.on('click', function () {
            var id = p.alert_id;
            if (id) openDetail(id, true);
          });
        },
      }).addTo(mapInstance);
    }
    var hintNoPolygons = document.getElementById('map-hint-no-polygons');
    if (hintNoPolygons) {
      hintNoPolygons.style.display = (showAlerts && (!data.alerts || !data.alerts.features || data.alerts.features.length === 0) && data.zips && data.zips.features && data.zips.features.length > 0) ? 'block' : 'none';
    }
    var alertCount = (data.alerts && data.alerts.features) ? data.alerts.features.length : 0;
    var zipCount = (data.zips && data.zips.features) ? data.zips.features.length : 0;
    var hintNoData = document.getElementById('map-hint-no-data');
    if (hintNoData) {
      hintNoData.style.display = (alertCount === 0 && zipCount === 0) ? 'block' : 'none';
    }

    if (showZips && data.zips && data.zips.features && data.zips.features.length) {
      var markers = L.markerClusterGroup();
      data.zips.features.forEach(function (f) {
        var coords = f.geometry && f.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        var props = f.properties || {};
        var topAlertIds = props.top_alert_ids || [];
        var topEvents = props.top_events || [];
        var topHeadlines = props.top_headlines || [];
        var alertsHtml = topAlertIds.slice(0, 5).map(function (aid, i) {
          var eventName = topEvents[i] || aid || 'Alert';
          var headline = (topHeadlines[i] || '').trim();
          var line = '<strong>' + escapeHtml(eventName) + '</strong>';
          if (headline) {
            var short = headline.length > 120 ? headline.slice(0, 117) + '…' : headline;
            line += '<br/><span class="map-popup-headline">' + escapeHtml(short) + '</span>';
          }
          line += '<br/><a href="#" class="map-popup-alert" data-id="' + escapeHtml(aid || '') + '">Open alert</a>';
          return line;
        }).join('<br/><br/>');
        var content = 'ZIP ' + (props.zip || '') + '<br/>Alerts: ' + (props.alert_count || 0) + ', max score: ' + (props.max_score || 0) + '<br/><br/>' + alertsHtml;
        var marker = L.marker([coords[1], coords[0]]);
        marker.bindPopup(content);
        marker.on('popupopen', function () {
          var pop = marker.getPopup();
          if (pop && pop.getElement()) {
            pop.getElement().querySelectorAll('.map-popup-alert').forEach(function (a) {
              a.addEventListener('click', function (e) { e.preventDefault(); openDetail(a.getAttribute('data-id'), true); });
            });
          }
        });
        markers.addLayer(marker);
      });
      mapLayers.zips = markers;
      mapInstance.addLayer(markers);
    }

    if (showRadar && data.meta && data.meta.radar_wms && data.meta.radar_wms.baseUrl) {
      var r = data.meta.radar_wms;
      var wmsOpts = { layers: r.layers, format: r.format || 'image/png', transparent: r.transparent !== false, opacity: radarOpacity / 100 };
      if (r.time_supported && mapRadarTime) wmsOpts.time = mapRadarTime;
      mapLayers.radar = wmsTileLayer(r.baseUrl, wmsOpts).addTo(mapInstance);
    }
    var radarTimeUi = document.getElementById('map-radar-time-ui');
    var radarNoTime = document.getElementById('map-radar-no-time');
    if (radarTimeUi && radarNoTime && data.meta && data.meta.radar_wms) {
      if (data.meta.radar_wms.time_supported) {
        radarTimeUi.style.display = showRadar ? 'block' : 'none';
        radarNoTime.style.display = 'none';
        var timeLabel = document.getElementById('map-radar-time-label');
        if (timeLabel) timeLabel.textContent = mapRadarTime ? mapRadarTime.slice(0, 19).replace('T', ' ') : '—';
      } else {
        radarTimeUi.style.display = 'none';
        radarNoTime.style.display = showRadar ? 'block' : 'none';
      }
    }
  }

  function buildRadarTimeSteps(meta) {
    if (!meta || !meta.time_extent || !meta.radar_wms || !meta.radar_wms.time_supported) return [];
    var start = new Date(meta.time_extent.start).getTime();
    var end = new Date(meta.time_extent.end).getTime();
    var stepMin = meta.time_extent.step_minutes || 5;
    var stepMs = stepMin * 60 * 1000;
    var steps = [];
    for (var t = start; t <= end; t += stepMs) steps.push(new Date(t).toISOString());
    return steps.length ? steps : [ meta.time_extent.end ];
  }

  function refreshRadarLayer() {
    if (!mapInstance || !mapLayers.radar) return;
    var showRadar = document.getElementById('map-layer-radar') && document.getElementById('map-layer-radar').checked;
    if (!showRadar) return;
    var meta = mapCache.meta;
    if (!meta || !meta.radar_wms || !meta.radar_wms.baseUrl) return;
    var r = meta.radar_wms;
    var radarOpacity = (document.getElementById('map-radar-opacity') && parseInt(document.getElementById('map-radar-opacity').value, 10)) || 70;
    mapInstance.removeLayer(mapLayers.radar);
    var wmsOpts = { layers: r.layers, format: r.format || 'image/png', transparent: r.transparent !== false, opacity: radarOpacity / 100 };
    if (r.time_supported && mapRadarTime) wmsOpts.time = mapRadarTime;
    mapLayers.radar = wmsTileLayer(r.baseUrl, wmsOpts).addTo(mapInstance);
    var timeLabel = document.getElementById('map-radar-time-label');
    if (timeLabel) timeLabel.textContent = mapRadarTime ? mapRadarTime.slice(0, 19).replace('T', ' ') : '—';
  }

  function advanceRadarTime() {
    var steps = window._mapRadarTimeSteps || [];
    if (steps.length === 0) return;
    var idx = steps.indexOf(mapRadarTime);
    if (idx < 0) idx = steps.length - 1;
    idx = (idx + 1) % steps.length;
    mapRadarTime = steps[idx];
    refreshRadarLayer();
  }

  function startRadarPlay() {
    if (mapRadarIntervalId) return;
    var speed = parseFloat((document.getElementById('map-radar-speed') && document.getElementById('map-radar-speed').value) || 1);
    var intervalMs = Math.max(500, 2000 / speed);
    mapRadarPlaying = true;
    var playBtn = document.getElementById('map-radar-play');
    var pauseBtn = document.getElementById('map-radar-pause');
    if (playBtn) playBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    mapRadarIntervalId = setInterval(advanceRadarTime, intervalMs);
  }

  function stopRadarPlay() {
    if (mapRadarIntervalId) clearInterval(mapRadarIntervalId);
    mapRadarIntervalId = null;
    mapRadarPlaying = false;
    var playBtn = document.getElementById('map-radar-play');
    var pauseBtn = document.getElementById('map-radar-pause');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
  }

  async function showMapPage() {
    stopRadarPlay();
    var mapErrorEl = document.getElementById('map-error');
    if (mapErrorEl) { mapErrorEl.style.display = 'none'; mapErrorEl.textContent = ''; }
    initMapIfNeeded();
    if (!mapInstance) return;
    var meta = mapCache.meta;
    try {
      if (!meta) {
        var filters = getMapFilters();
        meta = await api('/v1/map/meta' + (filters.states.length ? '?states=' + encodeURIComponent(filters.states.join(',')) : ''));
        mapCache.meta = meta;
      }
      if (meta.default_center && meta.default_center.length >= 2) {
        mapInstance.setView([meta.default_center[1], meta.default_center[0]], mapInstance.getZoom() || 4);
      }
      if (meta.time_extent && meta.radar_wms && meta.radar_wms.time_supported) {
        mapRadarTime = meta.time_extent.end || meta.time_extent.start;
        window._mapRadarTimeSteps = buildRadarTimeSteps(meta);
      } else {
        mapRadarTime = null;
        window._mapRadarTimeSteps = [];
      }
      var data = await loadMapData();
      addMapLayers(data, getMapFilters());
    } catch (err) {
      if (mapErrorEl) {
        mapErrorEl.textContent = 'Failed to load map data: ' + (err.message || String(err));
        mapErrorEl.style.display = 'block';
      }
    }
  }

  function updateSortIndicators() {
    document.querySelectorAll('#alerts-table th.sortable').forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var ind = th.querySelector('.sort-indicator');
      if (!ind) return;
      if (columnSort && columnSort.sort_by === key) {
        ind.textContent = columnSort.sort_dir === 'asc' ? '▲' : '▼';
      } else {
        ind.textContent = '';
      }
    });
  }

  async function loadAlerts() {
    updateBreadcrumb();
    var params = buildParams();
    var data = await api('/v1/alerts?' + params.toString());
    var alerts = data.alerts || [];
    var tbody = document.querySelector('#alerts-table tbody');
    tbody.innerHTML = '';
    alerts.forEach(function (a) {
      var eventName = a.event ?? '—';
      var alertClass = (a.alert_class || 'other').toLowerCase();
      var classBadge = '<span class="badge class">' + escapeHtml(alertClass) + '</span>';
      var statesArr = Array.isArray(a.impacted_states) ? a.impacted_states : [];
      var statesCell = statesArr.length ? statesArr.map(function (st) {
        return '<a href="#" class="state-chip" data-state="' + escapeHtml(String(st)) + '">' + escapeHtml(String(st)) + '</a>';
      }).join('') : '—';
      var zipCount = a.zip_count != null ? a.zip_count : (a.zips && a.zips.length ? a.zips.length : 0);
      var bucket = zipBucketLabel(zipCount);
      var sizeBadge = '<span class="badge ' + bucket.class + '">' + escapeHtml(bucket.label) + '</span>';
      var geomLabel = a.geom_present ? 'Y' : 'N';
      var geoMethod = a.geo_method || 'unknown';
      var geomCell = geomLabel + ' (' + escapeHtml(geoMethod) + ')';
      var areaCell = (a.area_sq_miles != null && a.area_sq_miles !== '') ? Number(a.area_sq_miles).toFixed(1) : '—';
      var densityCell = (a.zip_density != null && a.zip_density !== '') ? Number(a.zip_density).toFixed(2) : '—';
      var expiresIn = formatExpiresIn(a.expires);
      var lsrCount = a.lsr_match_count != null ? a.lsr_match_count : 0;
      var score = a.damage_score != null ? a.damage_score : 0;
      var badges = [];
      if (a.interesting_hail) badges.push('<span class="badge hail">HAIL 1.25+</span>');
      if (a.interesting_wind) badges.push('<span class="badge wind">WIND 70+</span>');
      if (a.interesting_rare_freeze) badges.push('<span class="badge freeze">RARE FREEZE</span>');
      if (!a.geom_present) badges.push('<span class="badge geom-missing">GEOM MISSING</span>');
      var alertId = a.alert_id || '';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(String(eventName)) + ' ' + classBadge + '</td>' +
        '<td class="states-cell">' + statesCell + '</td>' +
        '<td>' + Number(zipCount) + '</td>' +
        '<td>' + sizeBadge + '</td>' +
        '<td>' + geomCell + '</td>' +
        '<td>' + areaCell + '</td>' +
        '<td>' + densityCell + '</td>' +
        '<td>' + escapeHtml(expiresIn) + '</td>' +
        '<td>' + Number(lsrCount) + '</td>' +
        '<td>' + Number(score) + '</td>' +
        '<td>' + badges.join('') + '</td>' +
        '<td class="row-actions">' +
        '<button type="button" class="row-view-btn" data-id="' + escapeHtml(alertId) + '">View</button>' +
        '<button type="button" class="row-copy-btn" data-id="' + escapeHtml(alertId) + '">Copy</button>' +
        '<button type="button" class="row-queue-btn" data-id="' + escapeHtml(alertId) + '">Queue</button>' +
        '</td>';
      tr.querySelectorAll('.row-view-btn').forEach(function (btn) { btn.addEventListener('click', function () { openDetail(alertId); }); });
      tr.querySelectorAll('.row-copy-btn').forEach(function (btn) { btn.addEventListener('click', function () { copyAlertZipsLsr(alertId); }); });
      tr.querySelectorAll('.row-queue-btn').forEach(function (btn) { btn.addEventListener('click', function () { queueDeliveryFromRow(alertId); }); });
      tr.querySelectorAll('.state-chip').forEach(function (chip) {
        chip.addEventListener('click', function (e) { e.preventDefault(); openDrawer(chip.getAttribute('data-state')); });
      });
      tbody.appendChild(tr);
    });
    updateSortIndicators();
    if (alerts.length === 0) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="12">No alerts. Run "Run ingest once" or adjust filters.</td>';
      tbody.appendChild(empty);
    }
  }

  async function copyAlertZipsLsr(alertId) {
    try {
      const alert = await api('/v1/alerts/' + encodeURIComponent(alertId));
      const text = buildCopyBlock(alert);
      await navigator.clipboard.writeText(text);
      if (window.showCopyFeedback) window.showCopyFeedback('Copied ZIPs + LSR to clipboard.');
      else alert('Copied to clipboard.');
    } catch (e) {
      alert('Copy failed: ' + e.message);
    }
  }

  async function queueDeliveryFromRow(alertId) {
    try {
      await api('/v1/deliveries', { method: 'POST', body: JSON.stringify({ alert_id: alertId, destination: 'property_enrichment_v1', payload_version: 1, mode: 'queue' }) });
      if (window.showCopyFeedback) window.showCopyFeedback('Delivery queued.');
      else alert('Delivery queued.');
      loadAlerts();
    } catch (e) {
      alert('Queue failed: ' + e.message);
    }
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function whyZipsHelper(alert) {
    var area = alert.area_sq_miles != null ? Number(alert.area_sq_miles) : null;
    var density = alert.zip_density != null ? Number(alert.zip_density) : null;
    var zipCount = alert.zip_count != null ? Number(alert.zip_count) : 0;
    var BROAD_THRESHOLD_SQMI = 5000;
    var LOW_DENSITY = 0.5;
    var HIGH_DENSITY = 2;
    if (area != null && area > BROAD_THRESHOLD_SQMI) return 'Broad coverage event (area &gt; ' + BROAD_THRESHOLD_SQMI + ' sq mi).';
    if (density != null && density < LOW_DENSITY && zipCount > 100) return 'Broad coverage event (low ZIP density).';
    if (density != null && density >= HIGH_DENSITY) return 'Tight impact zone (high ZIP density).';
    return null;
  }

  async function openDetail(alertId, fromMap) {
    detailBackToPage = fromMap ? 'map' : 'dashboard';
    var backLink = document.getElementById('detail-back');
    if (backLink) backLink.textContent = detailBackToPage === 'map' ? '← Back to Map' : '← Back to Dashboard';
    const alert = await api('/v1/alerts/' + encodeURIComponent(alertId));
    currentAlert = alert;
    var states = Array.isArray(alert.impacted_states) ? alert.impacted_states.join(', ') : (alert.impacted_states || '—');
    var geoMethod = alert.geo_method || 'unknown';
    var zipInference = alert.zip_inference_method || 'none';
    var areaStr = (alert.area_sq_miles != null && alert.area_sq_miles !== '') ? Number(alert.area_sq_miles).toFixed(1) + ' sq mi' : '—';
    var densityStr = (alert.zip_density != null && alert.zip_density !== '') ? Number(alert.zip_density).toFixed(2) : '—';
    var lsrBlock = 'LSR: ' + (alert.lsr_match_count ?? 0) + ' matches. Hail max: ' + (alert.hail_max_inches ?? '—') + ' in. Wind max: ' + (alert.wind_max_mph ?? '—') + ' mph. Tornado: ' + (alert.tornado_count ?? 0) + '. Flood: ' + (alert.flood_count ?? 0) + '.';
    var why = whyZipsHelper(alert);
    var whyHtml = why ? '<p class="alert" style="background:#27272a;color:#a1a1aa;"><strong>Why so many ZIPs?</strong> ' + why + '</p>' : '';
    var html =
      '<table style="font-size:0.875rem;"><tr><td>Event</td><td>' + escapeHtml(alert.event || '—') + ' <span class="badge class">' + escapeHtml(alert.alert_class || 'other') + '</span></td></tr>' +
      '<tr><td>Severity</td><td>' + escapeHtml(alert.severity || '—') + '</td></tr>' +
      '<tr><td>Sent / Effective / Expires</td><td>' + escapeHtml(String(alert.sent || '—')) + ' / ' + escapeHtml(String(alert.effective || '—')) + ' / ' + escapeHtml(String(alert.expires || '—')) + '</td></tr>' +
      '<tr><td>Impacted states</td><td>' + escapeHtml(states) + '</td></tr>' +
      '<tr><td>ZIP count</td><td>' + (alert.zip_count ?? 0) + '</td></tr>' +
      '<tr><td>Geom present</td><td>' + (alert.geom_present ? 'Y' : 'N') + '</td></tr>' +
      '<tr><td>Geo method</td><td>' + escapeHtml(geoMethod) + '</td></tr>' +
      '<tr><td>ZIP inference method</td><td>' + escapeHtml(zipInference) + '</td></tr>' +
      '<tr><td>Area (sq mi)</td><td>' + areaStr + '</td></tr>' +
      '<tr><td>ZIP density</td><td>' + densityStr + '</td></tr>' +
      '<tr><td>LSR summary</td><td>' + escapeHtml(lsrBlock) + '</td></tr>' +
      '<tr><td>Score / Delivery</td><td>' + (alert.damage_score ?? 0) + ' / ' + escapeHtml(alert.delivery_status || '—') + '</td></tr></table>' +
      whyHtml +
      '<p><strong>Copy block</strong></p><div class="copy-block" id="copy-block">' + buildCopyBlock(alert).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
    document.getElementById('detail-content').innerHTML = html;
    document.getElementById('download-csv-btn').href = (config.apiBase || '') + '/v1/alerts/' + encodeURIComponent(alertId) + '/zips.csv';
    document.getElementById('detail-message').innerHTML = '';
    showPage('detail');
  }

  document.getElementById('copy-zips-lsr-btn').addEventListener('click', () => {
    if (!currentAlert) return;
    const text = buildCopyBlock(currentAlert);
    navigator.clipboard.writeText(text).then(() => {
      document.getElementById('detail-message').innerHTML = '<div class="alert success">Copied to clipboard.</div>';
    }).catch(() => {
      document.getElementById('detail-message').innerHTML = '<div class="alert error">Copy failed.</div>';
    });
  });

  document.getElementById('queue-delivery-btn').addEventListener('click', async () => {
    if (!currentAlert) return;
    try {
      const res = await api('/v1/deliveries', {
        method: 'POST',
        body: JSON.stringify({ alert_id: currentAlert.alert_id, destination: 'property_enrichment_v1', payload_version: 1, mode: 'queue' }),
      });
      document.getElementById('detail-message').innerHTML = '<div class="alert success">Queued. Event key: ' + res.event_key + '</div>';
    } catch (e) {
      document.getElementById('detail-message').innerHTML = '<div class="alert error">' + e.message + '</div>';
    }
  });

  document.getElementById('detail-back').addEventListener('click', (e) => {
    e.preventDefault();
    showPage(detailBackToPage);
    if (detailBackToPage === 'dashboard') loadAlerts();
  });

  async function loadOutbox() {
    const status = new URLSearchParams(window.location.search).get('status') || '';
    const path = status ? '/v1/outbox?status=' + encodeURIComponent(status) : '/v1/outbox';
    const data = await api(path);
    const tbody = document.querySelector('#outbox-table tbody');
    tbody.innerHTML = '';
    (data.outbox || []).forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (o.created_at || '') + '</td>' +
        '<td>' + (o.alert_id || '') + '</td>' +
        '<td>' + (o.destination || '') + '</td>' +
        '<td>' + (o.status || '') + '</td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (o.event_key || '') + '</td>' +
        '<td>' + (o.status === 'queued' || o.status === 'failed' ? '<button class="retry-btn" data-id="' + o.id + '">Retry</button> <button class="cancel-btn" data-id="' + o.id + '">Cancel</button>' : '') + '</td>';
      tr.querySelectorAll('.retry-btn').forEach(btn => btn.addEventListener('click', () => retryOutbox(btn.dataset.id)));
      tr.querySelectorAll('.cancel-btn').forEach(btn => btn.addEventListener('click', () => cancelOutbox(btn.dataset.id)));
      tbody.appendChild(tr);
    });
  }

  async function retryOutbox(id) {
    await api('/v1/outbox/' + id + '/retry', { method: 'POST' });
    loadOutbox();
  }

  async function cancelOutbox(id) {
    await api('/v1/outbox/' + id + '/cancel', { method: 'POST' });
    loadOutbox();
  }

  document.getElementById('filter-apply').addEventListener('click', loadAlerts);

  var sortModeEl = document.getElementById('sort-mode');
  if (sortModeEl) sortModeEl.addEventListener('change', loadAlerts);

  document.getElementById('sort-reset-preset').addEventListener('click', function () {
    columnSort = null;
    updateSortIndicators();
    loadAlerts();
  });

  document.getElementById('filter-clear-state').addEventListener('click', function () {
    stateFilter = '';
    var stateEl = document.getElementById('filter-state');
    if (stateEl) stateEl.value = '';
    updateBreadcrumb();
    loadAlerts();
  });

  var drawerClose = document.getElementById('drawer-close');
  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  var drawerOverlay = document.getElementById('state-drawer-overlay');
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

  document.querySelectorAll('.drawer-tabs button[data-drawer-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-drawer-tab');
      document.querySelectorAll('.drawer-tabs button[data-drawer-tab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-drawer-tab') === tab); });
      document.querySelectorAll('.drawer-body .tab-pane').forEach(function (p) {
        var isActive = p.id === 'drawer-tab-' + tab;
        p.classList.toggle('active', isActive);
      });
      loadDrawerTab(tab);
    });
  });

  function openDrawerFromUrl() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('state_drawer') === '1') {
      var state = (params.get('state') || '').trim().toUpperCase();
      if (state) openDrawer(state);
    }
  }

  document.querySelectorAll('#alerts-table th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (!key) return;
      if (columnSort && columnSort.sort_by === key) {
        columnSort.sort_dir = columnSort.sort_dir === 'desc' ? 'asc' : 'desc';
      } else {
        columnSort = { sort_by: key, sort_dir: 'desc' };
      }
      loadAlerts();
    });
  });

  document.getElementById('run-once-btn').addEventListener('click', async () => {
    const btn = document.getElementById('run-once-btn');
    const status = document.getElementById('run-once-status');
    btn.disabled = true;
    status.textContent = 'Running…';
    status.className = '';
    try {
      const data = await api('/v1/ingest/once', { method: 'POST' });
      var msg = 'Done. Fetched ' + (data.fetched_count ?? 0) + ' alerts, ' + (data.impact_inserted ?? 0) + ' inserted, ' + (data.impact_updated ?? 0) + ' updated.';
      if (data.duration_ms) msg += ' ' + Math.round(data.duration_ms / 1000) + 's.';
      msg += ' LSR pipeline: ' + (data.lsr_products_fetched ?? 0) + ' products, ' + (data.lsr_entries_parsed ?? 0) + ' observations, ' + (data.lsr_matches_inserted ?? 0) + ' matches (enrichment ran; 0 matches = none in lookback window or no warnings with geometry).';
      status.textContent = msg;
      status.className = 'alert success';
      loadAlerts();
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.className = 'alert error';
    }
    btn.disabled = false;
  });

  document.querySelectorAll('nav a[data-page]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showPage(a.dataset.page);
      if (a.dataset.page === 'dashboard') { loadAlerts(); openDrawerFromUrl(); }
      if (a.dataset.page === 'map') showMapPage();
      if (a.dataset.page === 'outbox') loadOutbox();
    });
  });

  var mapApplyBtn = document.getElementById('map-apply');
  if (mapApplyBtn) mapApplyBtn.addEventListener('click', function () { showMapPage(); });

  var mapRadarPlayBtn = document.getElementById('map-radar-play');
  if (mapRadarPlayBtn) mapRadarPlayBtn.addEventListener('click', startRadarPlay);
  var mapRadarPauseBtn = document.getElementById('map-radar-pause');
  if (mapRadarPauseBtn) mapRadarPauseBtn.addEventListener('click', stopRadarPlay);
  var mapRadarSpeedEl = document.getElementById('map-radar-speed');
  if (mapRadarSpeedEl) mapRadarSpeedEl.addEventListener('change', function () {
    if (mapRadarPlaying) { stopRadarPlay(); startRadarPlay(); }
  });

  function setAuth(t) {
    token = t;
    document.getElementById('login-section').style.display = t ? 'none' : 'block';
    document.getElementById('nav').style.display = t ? 'block' : 'none';
    if (t) {
      loadAlerts();
      openDrawerFromUrl();
    }
  }

  async function init() {
    await getConfig();
    if (config.supabaseUrl && config.supabaseAnonKey && typeof window.supabase !== 'undefined') {
      const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const { data: { session } } = await supabase.auth.getSession();
      setAuth(session?.access_token || null);
      document.getElementById('login-btn').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          setAuth(data.session?.access_token);
        } catch (e) {
          document.getElementById('login-error').textContent = e.message;
          document.getElementById('login-error').style.display = 'inline-block';
        }
      });
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        setAuth(null);
      });
    } else {
      setAuth('no-auth');
    }
  }

  init();
})();
