// i18n.js - English / French interface strings and locale-aware formatting.
(function (root) {
  'use strict';

  const STRINGS = {
    en: {
      title: 'Primary Care Accessibility & Health Equity Mapper',
      subtitle: 'Access to family medicine groups across a territory: availability, waits, continuity and who is left behind.',
      synthetic_badge: 'Synthetic demo data · fictional territory',
      real_badge: 'Data',
      clinic: 'Clinic', all_clinics: 'All clinics', from: 'From', to: 'To', language: 'Language',
      kpi_heading: 'Advanced-access indicators', kpi_note_period: 'Selected clinics and months',
      territory: 'Territory', vs_territory: 'Territory',
      registered: 'Registered patients', registered_sub: 'patients with a family physician at the selected clinics',
      tnaa: 'Third next available appointment', tnaa_short: 'Third next available',
      tnaa_sub: 'mean days to the 3rd open slot (weekly snapshots)',
      open48: 'Open slots within 48 h', open48_sub: 'share of slots still open for today and tomorrow',
      wait_median: 'Median wait', wait_median_sub: 'days from booking to visit, completed appointments',
      continuity: 'Relational continuity', continuity_sub: 'visits with own family physician (UPC)',
      walkin: 'Walk-in use', walkin_sub: 'registered patients’ physician visits that were walk-ins',
      multi: 'Multidisciplinary index', multi_sub: 'physician share of physician + professional visits (lower = more shared care)',
      noshow: 'No-show rate', noshow_sub: 'missed scheduled appointments',
      days: 'days', day: 'day',
      map_heading: 'Map of local areas', map_metric: 'Show on map', catchment: 'Catchment radius',
      m_access: 'Spatial accessibility (E2SFCA)', m_access_unit: 'physicians per 10,000 residents',
      m_attach: 'Attachment to a family physician', m_attach_unit: 'share of residents',
      m_quintile: 'Material and social deprivation', m_quintile_unit: 'quintile (1 = least deprived)',
      m_distance: 'Distance to nearest clinic', m_distance_unit: 'km, straight line from area centre',
      m_reach: 'Registered at selected clinics', m_reach_unit: 'patients per 1,000 residents',
      m_wait: 'Median wait (residents)', m_wait_unit: 'days',
      m_walkin: 'Walk-in share (residents)', m_walkin_unit: 'share of physician visits',
      m_noshow: 'No-show rate (residents)', m_noshow_unit: 'share of scheduled appointments',
      m_continuity: 'Relational continuity (residents)', m_continuity_unit: 'visits with own physician',
      insufficient: 'Too few visits to show', clinic_marker: 'Clinic (size = physicians)',
      area_profile: 'Area profile', area_hint: 'Hover over or select an area on the map to see its profile.',
      population: 'Population', density: 'Density', per_km2: 'per km²', urban_class: 'Setting',
      urban: 'Urban', suburban: 'Suburban', rural: 'Rural', quintile: 'Deprivation quintile', q: 'Q',
      where_registered: 'Where residents are registered', unattached_users: 'Unattached residents seen in walk-in',
      clear_selection: 'Clear selection',
      equity_heading: 'Equity gradient by deprivation quintile',
      equity_note: 'Q1 = least deprived, Q5 = most deprived (population-weighted quintiles). Gap = Q5 minus Q1.',
      gap: 'Gap',
      wait_heading: 'Wait-time distribution', wait_note: 'Days from booking to visit for completed scheduled appointments.',
      compare: 'Compare', compare_none: 'Distribution', compare_clinics: 'By clinic', compare_quintiles: 'By quintile',
      share_appointments: 'Share of appointments', seen_within: 'Seen within', median: 'Median', p90: '90th percentile',
      appointments: 'appointments', over: 'over',
      trend_heading: 'Indicator trends', indicator: 'Indicator', other_clinics: 'Other clinics',
      resources_heading: 'Resource allocation',
      demand_supply: 'Demand and supply by physician', demand_supply_clinics: 'Demand and supply by clinic',
      ds_note: 'Supply = completed visits in the 12 months before the reference date. Demand = registered patients × expected visits per year (manuscript Table 2).',
      demand: 'Expected demand', supply_own: 'Own registered patients', supply_other: 'Registered with a colleague',
      supply_unreg: 'Unregistered patients', visits: 'visits',
      mix_heading: 'Discipline mix of completed visits', mix_note: 'Share of completed visits by provider type, selected months.',
      t_physician: 'Physician', t_resident: 'Resident', t_nurse_practitioner: 'Nurse practitioner', t_nurse: 'Nurse',
      t_professional: 'Other professional', t_student: 'Student', t_external: 'External', t_other: 'Other',
      capacity_heading: 'Capacity by clinic', physicians: 'Physicians', patients_per_md: 'Patients per physician',
      catchment_ratio: 'Physicians per 10,000 in catchment (E2SFCA)', kind: 'Type',
      table_heading: 'Area data table', table_toggle: 'Show the data behind the map',
      area: 'Area', no_engine: 'Indicator output from emr_access was not found.',
      methods_heading: 'Methods and sources',
      methods_html:
        '<p><strong>Indicators.</strong> The six advanced-access indicators (third next available appointment, open slots within 48 hours, relational continuity, walk-in use, multidisciplinary integration and no-shows) and the demand and supply profile follow Breton et al., “Use of Electronic Medical Record Data to Create a Dashboard on Access to Primary Care”, <em>Healthcare Policy</em> 2023;18(4):72–88. They are computed by the companion engine <code>emr-access-indicators</code>. Proportions are always re-aggregated from numerators and denominators.</p>' +
        '<p><strong>Spatial accessibility.</strong> Enhanced two-step floating catchment area (E2SFCA; Luo &amp; Qi, 2009) with a Gaussian distance decay truncated at the catchment radius. Supply is the number of physicians in each clinic; demand is area population; distances are straight-line from the area centre, not travel times.</p>' +
        '<p><strong>Areas.</strong> Measures for residents of an area pool every visit they made to the selected clinics. Areas with fewer than 20 visits in the denominator are hidden. Deprivation quintiles are population-weighted.</p>' +
        '<p><strong>Data.</strong> The territory, clinics, patients and visits shown here are synthetic and fictional. The relationships between deprivation, distance and access were built into the generator to demonstrate the views; they are not findings.</p>',
      footer: 'Built with vanilla JavaScript and D3 6.3.1. No data leaves your browser.',
      window_label: 'Data window',
      gap_worse: 'more deprived areas fare worse', gap_better: 'more deprived areas fare better', gap_none: 'no difference',
      territory_values: 'Territory values (selected clinics and months)',
    },
    fr: {
      title: 'Cartographie de l’accessibilité et de l’équité en soins de première ligne',
      subtitle: 'L’accès aux groupes de médecine de famille sur un territoire : disponibilité, attente, continuité et populations laissées pour compte.',
      synthetic_badge: 'Données synthétiques · territoire fictif',
      real_badge: 'Données',
      clinic: 'Clinique', all_clinics: 'Toutes les cliniques', from: 'De', to: 'À', language: 'Langue',
      kpi_heading: 'Indicateurs de l’accès adapté', kpi_note_period: 'Cliniques et mois sélectionnés',
      territory: 'Territoire', vs_territory: 'Territoire',
      registered: 'Patients inscrits', registered_sub: 'patients ayant un médecin de famille dans les cliniques choisies',
      tnaa: 'Troisième prochain rendez-vous disponible', tnaa_short: '3e prochain disponible',
      tnaa_sub: 'jours moyens jusqu’à la 3e plage libre (instantanés hebdomadaires)',
      open48: 'Plages libres sous 48 h', open48_sub: 'part des plages encore libres pour aujourd’hui et demain',
      wait_median: 'Attente médiane', wait_median_sub: 'jours entre la prise de rendez-vous et la visite',
      continuity: 'Continuité relationnelle', continuity_sub: 'visites avec son médecin de famille (UPC)',
      walkin: 'Recours au sans rendez-vous', walkin_sub: 'visites médicales des patients inscrits faites sans rendez-vous',
      multi: 'Indice multidisciplinaire', multi_sub: 'part du médecin dans les visites médecin + professionnels (plus bas = plus de soins partagés)',
      noshow: 'Taux d’absence', noshow_sub: 'rendez-vous planifiés manqués',
      days: 'jours', day: 'jour',
      map_heading: 'Carte des secteurs', map_metric: 'Afficher', catchment: 'Rayon de desserte',
      m_access: 'Accessibilité spatiale (E2SFCA)', m_access_unit: 'médecins par 10 000 habitants',
      m_attach: 'Inscription auprès d’un médecin de famille', m_attach_unit: 'part des résidents',
      m_quintile: 'Défavorisation matérielle et sociale', m_quintile_unit: 'quintile (1 = moins défavorisé)',
      m_distance: 'Distance de la clinique la plus proche', m_distance_unit: 'km, à vol d’oiseau du centre du secteur',
      m_reach: 'Inscrits aux cliniques choisies', m_reach_unit: 'patients pour 1 000 habitants',
      m_wait: 'Attente médiane (résidents)', m_wait_unit: 'jours',
      m_walkin: 'Part sans rendez-vous (résidents)', m_walkin_unit: 'part des visites médicales',
      m_noshow: 'Taux d’absence (résidents)', m_noshow_unit: 'part des rendez-vous planifiés',
      m_continuity: 'Continuité relationnelle (résidents)', m_continuity_unit: 'visites avec son médecin',
      insufficient: 'Trop peu de visites', clinic_marker: 'Clinique (taille = médecins)',
      area_profile: 'Profil du secteur', area_hint: 'Survolez ou sélectionnez un secteur sur la carte pour voir son profil.',
      population: 'Population', density: 'Densité', per_km2: 'par km²', urban_class: 'Milieu',
      urban: 'Urbain', suburban: 'Périurbain', rural: 'Rural', quintile: 'Quintile de défavorisation', q: 'Q',
      where_registered: 'Où les résidents sont inscrits', unattached_users: 'Résidents non inscrits vus sans rendez-vous',
      clear_selection: 'Effacer la sélection',
      equity_heading: 'Gradient d’équité par quintile de défavorisation',
      equity_note: 'Q1 = moins défavorisé, Q5 = plus défavorisé (quintiles pondérés par la population). Écart = Q5 moins Q1.',
      gap: 'Écart',
      wait_heading: 'Distribution des délais d’attente', wait_note: 'Jours entre la prise de rendez-vous et la visite, rendez-vous planifiés complétés.',
      compare: 'Comparer', compare_none: 'Distribution', compare_clinics: 'Par clinique', compare_quintiles: 'Par quintile',
      share_appointments: 'Part des rendez-vous', seen_within: 'Vus en', median: 'Médiane', p90: '90e centile',
      appointments: 'rendez-vous', over: 'plus de',
      trend_heading: 'Évolution des indicateurs', indicator: 'Indicateur', other_clinics: 'Autres cliniques',
      resources_heading: 'Allocation des ressources',
      demand_supply: 'Demande et offre par médecin', demand_supply_clinics: 'Demande et offre par clinique',
      ds_note: 'Offre = visites complétées dans les 12 mois précédant la date de référence. Demande = patients inscrits × visites attendues par année (tableau 2 du manuscrit).',
      demand: 'Demande attendue', supply_own: 'Ses patients inscrits', supply_other: 'Inscrits chez un collègue',
      supply_unreg: 'Patients non inscrits', visits: 'visites',
      mix_heading: 'Répartition des visites par discipline', mix_note: 'Part des visites complétées par type d’intervenant, mois choisis.',
      t_physician: 'Médecin', t_resident: 'Résident', t_nurse_practitioner: 'IPS', t_nurse: 'Infirmière',
      t_professional: 'Autre professionnel', t_student: 'Stagiaire', t_external: 'Externe', t_other: 'Autre',
      capacity_heading: 'Capacité par clinique', physicians: 'Médecins', patients_per_md: 'Patients par médecin',
      catchment_ratio: 'Médecins par 10 000 dans la zone de desserte (E2SFCA)', kind: 'Type',
      table_heading: 'Tableau des secteurs', table_toggle: 'Afficher les données de la carte',
      area: 'Secteur', no_engine: 'Les résultats de emr_access sont introuvables.',
      methods_heading: 'Méthodes et sources',
      methods_html:
        '<p><strong>Indicateurs.</strong> Les six indicateurs de l’accès adapté (troisième prochain rendez-vous disponible, plages libres sous 48 heures, continuité relationnelle, recours au sans rendez-vous, intégration multidisciplinaire et absences) et le profil de l’offre et de la demande suivent Breton et coll., « Use of Electronic Medical Record Data to Create a Dashboard on Access to Primary Care », <em>Healthcare Policy</em> 2023;18(4):72-88. Ils sont calculés par le moteur <code>emr-access-indicators</code>. Les proportions sont toujours recalculées à partir des numérateurs et dénominateurs.</p>' +
        '<p><strong>Accessibilité spatiale.</strong> Méthode améliorée à deux étapes des zones de desserte flottantes (E2SFCA; Luo et Qi, 2009) avec décroissance gaussienne tronquée au rayon de desserte. L’offre est le nombre de médecins par clinique; la demande, la population du secteur; les distances sont à vol d’oiseau, pas des temps de déplacement.</p>' +
        '<p><strong>Secteurs.</strong> Les mesures des résidents d’un secteur regroupent toutes leurs visites aux cliniques choisies. Les secteurs comptant moins de 20 visites au dénominateur sont masqués. Les quintiles de défavorisation sont pondérés par la population.</p>' +
        '<p><strong>Données.</strong> Le territoire, les cliniques, les patients et les visites sont synthétiques et fictifs. Les liens entre défavorisation, distance et accès ont été intégrés au générateur pour illustrer les vues; ce ne sont pas des résultats.</p>',
      footer: 'Conçu en JavaScript natif avec D3 6.3.1. Aucune donnée ne quitte votre navigateur.',
      window_label: 'Période des données',
      gap_worse: 'les secteurs défavorisés s’en tirent moins bien', gap_better: 'les secteurs défavorisés s’en tirent mieux', gap_none: 'aucune différence',
      territory_values: 'Valeurs du territoire (cliniques et mois choisis)',
    },
  };

  const LOCALES = { en: 'en-CA', fr: 'fr-CA' };
  let lang = 'en';
  const cache = {};

  function nf(opts) {
    const key = lang + JSON.stringify(opts);
    if (!cache[key]) cache[key] = new Intl.NumberFormat(LOCALES[lang], opts);
    return cache[key];
  }

  const I18n = {
    setLang(l) { lang = STRINGS[l] ? l : 'en'; document.documentElement.lang = lang; },
    lang() { return lang; },
    t(key) { const s = STRINGS[lang][key]; return s === undefined ? (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key) : s; },
    num(x, digits) {
      if (x === null || x === undefined || isNaN(x)) return '–';
      const d = digits === undefined ? 0 : digits;
      return nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
    },
    pct(x, digits) {
      if (x === null || x === undefined || isNaN(x)) return '–';
      const d = digits === undefined ? 1 : digits;
      return nf({ style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
    },
    month(key, long) { // "2021-08"
      const p = key.split('-');
      const date = new Date(Date.UTC(+p[0], +p[1] - 1, 15));
      return new Intl.DateTimeFormat(LOCALES[lang], { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    },
    date(iso) {
      const p = iso.split('-');
      return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])));
    },
  };

  root.I18n = I18n;
}(this));
