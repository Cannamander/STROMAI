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
  let currentView = 'actionable'; // 'actionable' | 'all'

  async function loadAlerts() {
    const params = new URLSearchParams();
    if (document.getElementById('filter-active').checked) params.set('active', 'true');
    if (document.getElementById('filter-interesting').checked) params.set('interesting', 'true');
    const state = document.getElementById('filter-state').value.trim();
    if (state) params.set('state', state);
    var cls = document.getElementById('filter-class').value;
    var minScore = document.getElementById('filter-min-score').value;
    if (cls) params.set('class', cls);
    if (minScore) params.set('min_score', minScore);
    if (currentView === 'actionable') {
      params.set('actionable', 'true');
      params.set('sort', 'score_desc');
    } else {
      params.set('sort', 'newest');
    }
    const data = await api('/v1/alerts?' + params.toString());
    const alerts = data.alerts || [];
    const tbody = document.querySelector('#alerts-table tbody');
    tbody.innerHTML = '';
    alerts.forEach(function (a) {
      var eventName = a.event ?? '—';
      var alertClass = (a.alert_class || 'other').toLowerCase();
      var classBadge = '<span class="badge class">' + escapeHtml(alertClass) + '</span>';
      var states = a.impacted_states;
      if (Array.isArray(states)) states = states.join(', ');
      else if (typeof states === 'string' && states) states = states;
      else states = '—';
      var zipCount = a.zip_count != null ? a.zip_count : (a.zips && a.zips.length ? a.zips.length : 0);
      var geomLabel = a.geom_present ? 'Y' : 'N';
      var geoMethod = a.geo_method || 'unknown';
      var geomCell = geomLabel + ' (' + escapeHtml(geoMethod) + ')';
      var areaCell = (a.area_sq_miles != null && a.area_sq_miles !== '') ? Number(a.area_sq_miles).toFixed(1) : '—';
      var densityCell = (a.zip_density != null && a.zip_density !== '') ? Number(a.zip_density).toFixed(2) : '—';
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
        '<td>' + escapeHtml(String(states)) + '</td>' +
        '<td>' + Number(zipCount) + '</td>' +
        '<td>' + geomCell + '</td>' +
        '<td>' + areaCell + '</td>' +
        '<td>' + densityCell + '</td>' +
        '<td>' + Number(lsrCount) + '</td>' +
        '<td>' + Number(score) + '</td>' +
        '<td>' + badges.join('') + '</td>' +
        '<td class="row-actions">' +
        '<button type="button" class="row-view-btn" data-id="' + escapeHtml(alertId) + '">View</button>' +
        '<button type="button" class="row-copy-btn" data-id="' + escapeHtml(alertId) + '">Copy</button>' +
        '<button type="button" class="row-queue-btn" data-id="' + escapeHtml(alertId) + '">Queue</button>' +
        '</td>';
      tr.querySelector('.row-view-btn').addEventListener('click', function () { openDetail(alertId); });
      tr.querySelector('.row-copy-btn').addEventListener('click', function () { copyAlertZipsLsr(alertId); });
      tr.querySelector('.row-queue-btn').addEventListener('click', function () { queueDeliveryFromRow(alertId); });
      tbody.appendChild(tr);
    });
    if (alerts.length === 0) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="10">No alerts. Try "All Alerts" or run Run ingest once.</td>';
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

  async function openDetail(alertId) {
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

  document.getElementById('detail-back').addEventListener('click', (e) => { e.preventDefault(); showPage('dashboard'); loadAlerts(); });

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

  document.getElementById('tab-actionable').addEventListener('click', function () {
    currentView = 'actionable';
    document.getElementById('tab-actionable').classList.add('active');
    document.getElementById('tab-all').classList.remove('active');
    loadAlerts();
  });
  document.getElementById('tab-all').addEventListener('click', function () {
    currentView = 'all';
    document.getElementById('tab-all').classList.add('active');
    document.getElementById('tab-actionable').classList.remove('active');
    loadAlerts();
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
      if (a.dataset.page === 'dashboard') loadAlerts();
      if (a.dataset.page === 'outbox') loadOutbox();
    });
  });

  function setAuth(t) {
    token = t;
    document.getElementById('login-section').style.display = t ? 'none' : 'block';
    document.getElementById('nav').style.display = t ? 'block' : 'none';
    if (t) {
      loadAlerts();
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
